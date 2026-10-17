"""Rerank retrieval candidates.

RERANK=cross_encoder (default): order by the MiniLM cross-encoder.
RERANK=ranker: order by the frozen ML4 LambdaRank model, which also uses the
retriever's signals; falls back to the cross-encoder when the model or the
signals are missing. relevance_score stays the cross-encoder logit either way,
so confidence keeps its scale.
"""

import os
from pathlib import Path

import margin_ml  # noqa: F401  (puts ml/ on the path)

RERANK = os.getenv("RERANK", "cross_encoder")
RANKER_PATH = Path(os.getenv("RANKER_PATH", margin_ml.ML_ROOT / "ml/models/artifacts/ranker.joblib"))
# Added to verified concepts' logit (cross-encoder mode). Untuned.
VERIFIED_BOOST = float(os.getenv("VERIFIED_BOOST", "1.0"))
SIGNALS = ("bm25", "bm25_rank", "cosine", "dense_rank", "fused_rank", "score")

_cross_encoder = None
_ranker = None


def get_cross_encoder():
    global _cross_encoder
    if _cross_encoder is None:
        from sentence_transformers import CrossEncoder
        print("Loading reranker model...")
        _cross_encoder = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
    return _cross_encoder


def get_ranker():
    global _ranker
    if _ranker is None and RANKER_PATH.exists():
        from ml.ranking.ranker import load
        _ranker = load(RANKER_PATH)
    return _ranker


def rerank(question: str, chunks: list, top_k: int = 5, mode: str = None):
    if not chunks:
        return []
    logits = get_cross_encoder().predict([[question, c["text"]] for c in chunks])
    for chunk, logit in zip(chunks, logits):
        chunk["cross_encoder"] = float(logit)
        chunk["relevance_score"] = float(logit) + (VERIFIED_BOOST if chunk.get("verified") else 0.0)
    ranker = get_ranker() if (mode or RERANK) == "ranker" else None
    if ranker is not None and all(all(key in c for key in SIGNALS) for c in chunks):
        from ml.ranking.ranker import score
        for chunk, value in zip(chunks, score(ranker, question, chunks)):
            chunk["ranker_score"] = value
        key = "ranker_score"
    else:
        key = "relevance_score"
    return sorted(chunks, key=lambda c: c[key], reverse=True)[:top_k]
