"""ML4: ranker features and graded labels.

Features use only query-time signals. Labels: 2 = answer page with the quote,
1 = answer page, 0 = other.
"""

import math
import re

from ml.retrieval.hybrid import tokenize

CONCEPT_TYPES = ("Definition", "Notation", "Algorithm")  # every other concept type is a result
QUESTION_WORDS = ("what", "why", "how", "which", "when")

FEATURES = (
    "bm25", "bm25_relative", "bm25_rank_inverse",
    "cosine", "cosine_gap", "dense_rank_inverse",
    "rrf", "fused_rank_inverse",
    "cross_encoder", "cross_encoder_gap", "cross_encoder_rank_inverse",
    "is_concept", "concept_definition", "concept_notation", "concept_algorithm", "concept_result", "verified",
    "title_in_question", "question_coverage", "log_length", "page_position",
    *(f"question_{word}" for word in QUESTION_WORDS), "question_length",
)


def compact(text):
    return re.sub(r"\s+", "", text)


def label(item, answer_pages, answer_quote, word_share=0.6):
    if item.get("page") not in set(answer_pages):
        return 0
    if answer_quote and compact(answer_quote) in compact(item.get("text", "")):
        return 2
    quote = set(tokenize(answer_quote or ""))
    return 2 if quote and len(quote & set(tokenize(item.get("text", "")))) / len(quote) >= word_share else 1


def _ranks(values):
    order = sorted(range(len(values)), key=lambda i: -values[i])
    ranks = [0] * len(values)
    for rank, i in enumerate(order, 1):
        ranks[i] = rank
    return ranks


def group_features(question, items):
    """Feature rows for one question's candidates."""
    if not items:
        return []
    terms = set(tokenize(question))
    first = question.strip().lower().split(" ", 1)[0] if question.strip() else ""
    best_bm25 = max(item["bm25"] for item in items)
    best_cosine = max(item["cosine"] for item in items)
    best_ce = max(item["cross_encoder"] for item in items)
    ce_ranks = _ranks([item["cross_encoder"] for item in items])
    rows = []
    for item, ce_rank in zip(items, ce_ranks):
        concept = item.get("kind") == "concept"
        kind = item.get("type") or ""
        text_terms = tokenize(item.get("text", ""))
        title_terms = set(tokenize(item.get("title") or "")) if concept else set()
        rows.append({
            "bm25": item["bm25"],
            "bm25_relative": item["bm25"] / best_bm25 if best_bm25 > 0 else 0.0,
            "bm25_rank_inverse": 1 / item["bm25_rank"],
            "cosine": item["cosine"],
            "cosine_gap": item["cosine"] - best_cosine,
            "dense_rank_inverse": 1 / item["dense_rank"],
            "rrf": item["score"],
            "fused_rank_inverse": 1 / item["fused_rank"],
            "cross_encoder": item["cross_encoder"],
            "cross_encoder_gap": item["cross_encoder"] - best_ce,
            "cross_encoder_rank_inverse": 1 / ce_rank,
            "is_concept": float(concept),
            "concept_definition": float(concept and kind == "Definition"),
            "concept_notation": float(concept and kind == "Notation"),
            "concept_algorithm": float(concept and kind == "Algorithm"),
            "concept_result": float(concept and kind not in CONCEPT_TYPES),
            "verified": float(bool(item.get("verified"))),
            "title_in_question": len(title_terms & terms) / len(title_terms) if title_terms else 0.0,
            "question_coverage": len(terms & set(text_terms)) / len(terms) if terms else 0.0,
            "log_length": math.log1p(len(text_terms)),
            # last_page: highest indexed page of the item's PDF (the service has no page count)
            "page_position": (item.get("page") or 0) / item["last_page"] if item.get("last_page") else 0.0,
            **{f"question_{word}": float(first == word) for word in QUESTION_WORDS},
            "question_length": float(len(terms)),
        })
    return rows


def vector(row):
    return [row[name] for name in FEATURES]
