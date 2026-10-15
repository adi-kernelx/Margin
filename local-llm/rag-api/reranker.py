from sentence_transformers import CrossEncoder
import os

print("Loading reranker model...")
# Keep it small: cross-encoder/ms-marco-MiniLM-L-6-v2 (~80MB)
reranker_model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
print("Reranker model loaded.")

# Added to the cross-encoder logit of concepts the reader has verified. A small
# nudge, not an override: verification says the concept is correct, not that it
# answers this question. Not tuned (no verified concepts in the evaluation data).
VERIFIED_BOOST = float(os.getenv("VERIFIED_BOOST", "1.0"))


def rerank(question: str, chunks: list, top_k: int = 5):
    if not chunks:
        return []

    # CrossEncoder input is list of pairs: [[quest, doc1], [quest, doc2], ...]
    pairs = [[question, c["text"]] for c in chunks]

    scores = reranker_model.predict(pairs)

    # Attach scores to chunks
    for i, chunk in enumerate(chunks):
        chunk["relevance_score"] = float(scores[i]) + (VERIFIED_BOOST if chunk.get("verified") else 0.0)

    # Sort by new score
    # Filter out very low items (negative scores in CrossEncoder mean irrelevant)
    ranked = sorted(chunks, key=lambda x: x["relevance_score"], reverse=True)

    # Optional: Hard cutoff for bad matches
    # ranked = [c for c in ranked if c["relevance_score"] > -2.0]

    return ranked[:top_k]
