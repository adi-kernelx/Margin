"""Page retrieval metrics shared by the baseline, live and ranker evaluators."""

import math

METRICS = ("recall_at_5", "mrr_at_10", "ndcg_at_10")


def metrics(ranked_chunks, answer_pages):
    """Binary page gains; duplicates keep their ranks but earn no extra gain.

    nDCG's ideal includes all gold pages, even those absent from the candidate
    pool. No gold pages returns zero; evaluators exclude unanswerable questions.
    """
    pages = set(answer_pages)
    hit = float(any(chunk["page"] in pages for chunk in ranked_chunks[:5]))
    reciprocal = next((1 / rank for rank, chunk in enumerate(ranked_chunks[:10], 1)
                       if chunk["page"] in pages), 0.0)
    seen, dcg = set(), 0.0
    for rank, chunk in enumerate(ranked_chunks[:10], 1):
        page = chunk["page"]
        if page in pages and page not in seen:
            dcg += 1 / math.log2(rank + 1)
            seen.add(page)
    ideal = sum(1 / math.log2(rank + 1) for rank in range(1, min(len(pages), 10) + 1))
    return {"recall_at_5": hit, "mrr_at_10": reciprocal,
            "ndcg_at_10": dcg / ideal if ideal else 0.0}
