"""ML3.5: score the live /query retrieval code, not a re-implementation of it.

Imports the RAG service's retriever, concept indexer and cross-encoder reranker
and runs them on in-memory Qdrant, filled the way the service fills it:
passages from the legacy chunker over native PDF words (as in ML3.2) and the
PDF's OKF concepts through concepts_api.index_concepts. The service fetches
3 x topK = 24 candidates and reranks them; all 24 stay ranked here, so MRR@10
is defined. Methods:
  dense_rerank            the service before ML3.5 (Qdrant cosine, then rerank)
  hybrid_concepts         ML3.4's best retriever, no rerank
  hybrid_concepts_rerank  the service after ML3.5
  hybrid_rerank           the same without concepts
Train split only unless --frozen-test-milestone.

    python -m ml.eval.live_rag_eval --out ml/results/live_rag_train.json
"""

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import pymupdf

from ml.eval.baseline_current_rag import ROOT, load_chunker, metrics, pdf_chunks
from ml.eval.stats import document_bootstrap
from ml.eval.validate_questions import group_splits, validate_lines

sys.path.append(str(ROOT / "local-llm/rag-api"))
METHODS = ("dense_rerank", "hybrid_concepts", "hybrid_rerank", "hybrid_concepts_rerank")
BASELINE = "dense_rerank"
CANDIDATES = 24


def load_questions(args):
    manifest = {row["file"]: row for row in csv.DictReader((ROOT / "Test PDFs/manifest.csv").open(encoding="utf-8"))}
    split = group_splits(json.loads((ROOT / "ml/splits.json").read_text(encoding="utf-8")))

    def page_texts(file):
        with pymupdf.open(args.pdf_dir / file) as document:
            return [page.get_text() for page in document]

    with args.questions.open(encoding="utf-8") as source:
        questions, errors = validate_lines(source, manifest, split, page_texts)
    if errors:
        raise ValueError("Invalid question collection: " + "; ".join(errors))
    splits = {"train", "test"} if args.frozen_test_milestone else {"train"}
    return [q for q in questions if q["answerable"] and q["split"] in splits], splits


def fill(files, pdf_dir, bundles, encode):
    import yaml
    from qdrant_client import QdrantClient
    from qdrant_client.models import PointStruct

    import concepts_api
    import store
    store.set_qdrant(QdrantClient(":memory:"))
    store.ensure_collection(store.PASSAGES)
    chunker = load_chunker()
    counts = {"passages": 0, "concepts": 0}
    point = 0
    for file in files:
        chunks = pdf_chunks(pdf_dir / file, chunker)
        vectors = encode([c["text"] for c in chunks])
        store.get_qdrant().upsert(store.PASSAGES, points=[
            PointStruct(id=point + i, vector=list(v), payload={"docId": file, "pdfFingerprint": file, "page": c["page"],
                                                              "text": c["text"], "bbox": c["bbox"]})
            for i, (c, v) in enumerate(zip(chunks, vectors))])
        point += len(chunks)
        counts["passages"] += len(chunks)
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]  # as in ml/okf/build_all.py
        concepts = []
        for path in sorted((bundles / stem).rglob("*.md")) if (bundles / stem).is_dir() else []:
            if path.name in ("index.md", "log.md"):
                continue
            markdown = path.read_text(encoding="utf-8")
            meta = yaml.safe_load(markdown.split("---\n", 2)[1])
            concepts.append(concepts_api.ConceptIn(
                path=path.relative_to(bundles / stem).as_posix(), type=meta["type"], title=meta["title"],
                description=meta.get("description", ""), page=meta["margin"]["page"], markdown=markdown))
        concepts_api.index_concepts(concepts_api.ConceptIndexRequest(docId=file, pdfFingerprint=file, concepts=concepts),
                                    encode)
        counts["concepts"] += len(concepts)
    store.changed()
    return counts


def evaluate(questions):
    import retriever
    from reranker import rerank
    from schemas import QueryScope
    results = []
    for question in questions:
        scope = QueryScope(docIds=[question["file"]])
        row = {"file": question["file"], "split": question["split"], "qid": question["qid"]}
        dense = retriever.retrieve(question["question"], CANDIDATES, scope, "dense")
        hybrid = retriever.retrieve(question["question"], CANDIDATES, scope, "hybrid")
        concepts = retriever.retrieve(question["question"], CANDIDATES, scope, "hybrid_concepts")
        ranked = {"dense_rerank": rerank(question["question"], dense, CANDIDATES),
                  "hybrid_concepts": concepts,
                  "hybrid_rerank": rerank(question["question"], hybrid, CANDIDATES),
                  "hybrid_concepts_rerank": rerank(question["question"], [dict(c) for c in concepts], CANDIDATES)}
        for method, items in ranked.items():
            row[method] = metrics(items, question["answer_pages"])
        row["concepts_in_top5"] = sum(item["kind"] == "concept" for item in ranked["hybrid_concepts_rerank"][:5])
        results.append(row)
    return results


def summarise(results):
    report = {}
    for method in METHODS:
        report[method] = {}
        for metric in ("recall_at_5", "mrr_at_10"):
            by_file = defaultdict(list)
            for row in results:
                by_file[row["file"]].append(row[method][metric])
            report[method][metric] = document_bootstrap(by_file)
    report["paired_vs_" + BASELINE] = {}
    for method in METHODS[1:]:
        report["paired_vs_" + BASELINE][method] = {}
        for metric in ("recall_at_5", "mrr_at_10"):
            by_file = defaultdict(list)
            for row in results:
                by_file[row["file"]].append(row[method][metric] - row[BASELINE][metric])
            report["paired_vs_" + BASELINE][method][metric] = document_bootstrap(by_file)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--questions", type=Path, default=ROOT / "ml/eval/questions.jsonl")
    parser.add_argument("--pdf-dir", type=Path, default=ROOT / "Test PDFs")
    parser.add_argument("--bundles", type=Path, default=ROOT / "ml/out/bundles")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--frozen-test-milestone", action="store_true", help="also score the test split")
    args = parser.parse_args()
    questions, splits = load_questions(args)
    if not questions:
        raise SystemExit("No answerable questions in the scored splits")
    from embedder import get_embeddings
    files = sorted({q["file"] for q in questions})
    counts = fill(files, args.pdf_dir, args.bundles, get_embeddings)
    results = evaluate(questions)
    report = {"questions": len(results), "documents": len(files), "splits": sorted(splits), "candidates": CANDIDATES,
              **counts, "metrics": summarise(results),
              "mean_concepts_in_top5": round(sum(r["concepts_in_top5"] for r in results) / len(results), 2)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{len(results)} questions, {len(files)} documents, {counts}")
    show = lambda values: "   ".join(f"{m} {v['value']:+.3f} [{v['ci95'][0]:+.3f}, {v['ci95'][1]:+.3f}]"
                                     for m, v in values.items())
    for method in METHODS:
        print(f"{method:24} {show(report['metrics'][method])}")
    for method, values in report["metrics"]["paired_vs_" + BASELINE].items():
        print(f"{method + ' - ' + BASELINE:40} {show(values)}")


if __name__ == "__main__":
    main()
