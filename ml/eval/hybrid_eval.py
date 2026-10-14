"""ML3.2: compare dense, BM25, hybrid and hybrid+concepts retrieval on the questions.

Same setting as ml/eval/baseline_current_rag.py: native PDF words, the legacy
chunker, search scoped to the question's PDF, MiniLM embeddings, exact cosine.
Methods:
  dense            cosine over passages (the current retriever, before reranking)
  bm25             hand-written BM25 over passages
  hybrid           RRF of the two
  hybrid_concepts  RRF over passages plus the PDF's OKF concepts (title,
                   description and text); a concept hit counts at its page
Recall@5 and MRR@10 by page, 95% intervals resampling whole documents. Only the
train split is scored unless --frozen-test-milestone is given.

    python -m ml.eval.hybrid_eval --out ml/results/hybrid_retrieval_train.json
"""

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

import pymupdf

from ml.eval.baseline_current_rag import EMBEDDER, ROOT, load_chunker, metrics, pdf_chunks
from ml.eval.okf_sample import concepts_of
from ml.eval.stats import document_bootstrap
from ml.eval.validate_questions import group_splits, validate_lines
from ml.retrieval.hybrid import HybridRetriever

METHODS = ("dense", "bm25", "hybrid", "hybrid_concepts")


def concept_items(bundle):
    items = []
    for meta, sentence, body, _ in (concepts_of(bundle).values() if bundle.is_dir() else []):
        text = " ".join(part for part in (meta.get("title"), meta.get("description"), sentence, body) if part)
        items.append({"text": text, "page": meta["margin"]["page"], "concept": True})
    return items


def evaluate(questions, passages, concepts, encode, depth=10):
    results = []
    for file in sorted({q["file"] for q in questions}):
        both = passages[file] + concepts.get(file, [])
        vectors = encode([item["text"] for item in both])
        plain = HybridRetriever(passages[file], vectors[:len(passages[file])])
        extended = HybridRetriever(both, vectors)
        for question in (q for q in questions if q["file"] == file):
            query_vector = encode([question["question"]])[0]
            row = {"file": file, "split": question["split"], "qid": question["qid"]}
            for method in ("dense", "bm25", "hybrid"):
                row[method] = metrics(plain.search(question["question"], query_vector, depth, method),
                                      question["answer_pages"])
            ranked = extended.search(question["question"], query_vector, depth, "hybrid")
            row["hybrid_concepts"] = metrics(ranked, question["answer_pages"])
            row["concepts_in_top5"] = sum(bool(item.get("concept")) for item in ranked[:5])
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
            report[method][metric] = document_bootstrap(by_file) if by_file else None
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--questions", type=Path, default=ROOT / "ml/eval/questions.jsonl")
    parser.add_argument("--pdf-dir", type=Path, default=ROOT / "Test PDFs")
    parser.add_argument("--bundles", type=Path, default=ROOT / "ml/out/bundles")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--frozen-test-milestone", action="store_true", help="also score the test split")
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
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
    questions = [q for q in questions if q["answerable"] and q["split"] in splits]
    if not questions:
        raise SystemExit("No answerable questions in the scored splits")
    chunker = load_chunker()
    files = sorted({q["file"] for q in questions})
    passages = {f: [{"text": c["text"], "page": c["page"]} for c in pdf_chunks(args.pdf_dir / f, chunker)] for f in files}
    stem = lambda f: re.sub(r"[^A-Za-z0-9._-]+", "_", Path(f).stem)[:80]       # as in ml/okf/build_all.py
    concepts = {f: concept_items(args.bundles / stem(f)) for f in files}
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(EMBEDDER, device="cpu", local_files_only=args.local_only)
    results = evaluate(questions, passages, concepts, lambda texts: model.encode(texts, show_progress_bar=False))
    report = {"questions": len(results), "documents": len(files), "splits": sorted(splits),
              "passages": sum(map(len, passages.values())), "concepts": sum(map(len, concepts.values())),
              "metrics": summarise(results),
              "mean_concepts_in_top5": round(sum(r["concepts_in_top5"] for r in results) / len(results), 2)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{len(results)} questions, {len(files)} documents")
    for method, values in report["metrics"].items():
        print(f"{method:16} " + "   ".join(f"{m} {v['value']:.3f} [{v['ci95'][0]:.3f}, {v['ci95'][1]:.3f}]"
                                         for m, v in values.items()))


if __name__ == "__main__":
    main()
