"""Current RAG smoke/gold baseline, CPU, no Docker or running services.

Exact brute-force cosine stands in for Qdrant's approximate HNSW search.
Use native PyMuPDF word spans with the imported legacy chunk_spans (no copy).
Search is scoped to the question's named PDF, not the whole library.
Retrieve top 8, rerank those 8, report Recall@5 and MRR@10 on those rankings.
Both rankings are truncated at 8 by the legacy candidate budget, so ranks 9–10
cannot score; MRR is not computed from just the 5 displayed/context chunks.
Native text, rather than legacy OCR input, and exact search are approximations
to the existing retrieval mechanism, not a live end-to-end service benchmark.
"""

import argparse
import csv
import importlib.util
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pymupdf

from ml.eval.stats import document_bootstrap
from ml.eval.validate_questions import group_splits, validate_lines


ROOT = Path(__file__).resolve().parents[2]
EMBEDDER = "sentence-transformers/all-MiniLM-L6-v2"
RERANKER = "cross-encoder/ms-marco-MiniLM-L-6-v2"


def load_chunker():
    spec = importlib.util.spec_from_file_location("margin_legacy_ingest", ROOT / "local-llm/rag-api/ingest.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.chunk_spans


def pdf_chunks(path, chunker):
    spans = []
    with pymupdf.open(path) as document:
        for page_number, page in enumerate(document, 1):
            width, height = page.rect.width, page.rect.height
            for x0, y0, x1, y1, text, *_ in page.get_text("words"):
                if text.strip():
                    spans.append({"docId": path.name, "pdfFingerprint": path.name,
                                  "page": page_number, "text": text,
                                  "bbox": {"x0": x0/width, "y0": y0/height, "x1": x1/width, "y1": y1/height}})
    spans.sort(key=lambda span: (span["page"], span["bbox"]["y0"], span["bbox"]["x0"]))
    return chunker(spans)


def cosine_order(embeddings, query, top_k=8):
    vectors, query = np.asarray(embeddings), np.asarray(query)
    norms = np.linalg.norm(vectors, axis=1) * np.linalg.norm(query)
    scores = np.divide(vectors @ query, norms, out=np.zeros(len(vectors), dtype=float), where=norms > 0)
    return np.argsort(-scores, kind="stable")[:top_k].tolist()


def metrics(ranked_chunks, answer_pages):
    pages = set(answer_pages)
    hit = float(any(chunk["page"] in pages for chunk in ranked_chunks[:5]))
    reciprocal = next((1 / rank for rank, chunk in enumerate(ranked_chunks[:10], 1) if chunk["page"] in pages), 0.0)
    return {"recall_at_5": hit, "mrr_at_10": reciprocal}


def evaluate(questions, chunks_by_file, encode, predict):
    """Model functions are injected to exercise real evaluation without downloads."""
    results = []
    vectors = {file: encode([c["text"] for c in chunks]) for file, chunks in chunks_by_file.items() if chunks}
    for question in questions:
        if not question["answerable"]:
            continue
        chunks = chunks_by_file[question["file"]]
        vector_ranked = []
        if chunks:
            indices = cosine_order(vectors[question["file"]], encode([question["question"]])[0])
            vector_ranked = [chunks[index] for index in indices]
        scores = predict([[question["question"], chunk["text"]] for chunk in vector_ranked]) if vector_ranked else []
        if len(scores) != len(vector_ranked):
            raise ValueError("Reranker returned wrong number of scores")
        reranked = [vector_ranked[i] for i in sorted(range(len(scores)), key=lambda i: -float(scores[i]))]
        results.append({"file": question["file"], "split": question["split"],
                        "vector": metrics(vector_ranked, question["answer_pages"]),
                        "reranked": metrics(reranked, question["answer_pages"])})
    return results


def report_results(results):
    report = {}
    for split in ("train", "test"):
        report[split] = {}
        for method in ("vector", "reranked"):
            report[split][method] = {}
            for metric in ("recall_at_5", "mrr_at_10"):
                by_file = defaultdict(list)
                for row in results:
                    if row["split"] == split:
                        by_file[row["file"]].append(row[method][metric])
                report[split][method][metric] = document_bootstrap(by_file) if by_file else None
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", type=Path)
    parser.add_argument("--pdf-dir", type=Path, default=ROOT / "Test PDFs")
    parser.add_argument("--out", type=Path, default=ROOT / "ml/results/baseline_current_rag.json")
    parser.add_argument("--local-only", action="store_true", help="Require already cached model files")
    args = parser.parse_args()
    real = ROOT / "ml/eval/questions.jsonl"
    question_path = args.questions or (real if real.exists() else ROOT / "ml/eval/questions.example.jsonl")
    example = question_path.resolve() == (ROOT / "ml/eval/questions.example.jsonl").resolve()
    manifest = {row["file"]: row for row in csv.DictReader((ROOT / "Test PDFs/manifest.csv").open(encoding="utf-8"))}
    split = group_splits(json.loads((ROOT / "ml/splits.json").read_text(encoding="utf-8")))

    def page_texts(file):
        with pymupdf.open(args.pdf_dir / file) as document:
            return [page.get_text() for page in document]

    with question_path.open(encoding="utf-8") as source:
        questions, errors = validate_lines(source, manifest, split, page_texts)
    if errors:
        raise ValueError("Invalid question collection: " + "; ".join(errors))
    print("EXAMPLE SMOKE BASELINE — not the 200-question evaluation" if example else "User-question baseline")
    chunker = load_chunker()
    chunks = {file: pdf_chunks(args.pdf_dir / file, chunker) for file in sorted({q["file"] for q in questions if q["answerable"]})}
    print(f"Native chunks: {sum(map(len, chunks.values()))} across {len(chunks)} PDFs", flush=True)
    from sentence_transformers import SentenceTransformer, CrossEncoder
    embedding_model = SentenceTransformer(EMBEDDER, device="cpu", local_files_only=args.local_only)
    reranking_model = CrossEncoder(RERANKER, device="cpu", local_files_only=args.local_only)
    results = evaluate(questions, chunks,
                       lambda texts: embedding_model.encode(texts, show_progress_bar=False),
                       lambda pairs: reranking_model.predict(pairs, show_progress_bar=False))
    report = {"example_only": example, "question_count": len(questions),
              "answerable_count": len(results), "unanswerable_excluded": sum(not q["answerable"] for q in questions),
              "candidate_depth": 8, "context_depth": 5, "bootstrap_resamples": 2000, "seed": 20261006,
              "metrics": report_results(results)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("Split  Method     Recall@5 [95% CI]        MRR@10 [95% CI] (8 candidates)")
    for split, methods in report["metrics"].items():
        for method, values in methods.items():
            parts = []
            for value in values.values():
                parts.append("n/a" if value is None else f"{value['value']:.3f} [{value['ci95'][0]:.3f}, {value['ci95'][1]:.3f}]")
            print(f"{split:6} {method:10} " + "   ".join(parts))
    print("Intervals from very few example documents are not reliable evidence of quality." if example else "Intervals resample whole documents; no model tuning was performed.")


if __name__ == "__main__":
    main()
