"""ML3.2 hybrid retrieval: hand-checked BM25, RRF and fusion (no model downloads)."""

import math

import pytest

from ml.retrieval.hybrid import BM25, HybridRetriever, rrf, tokenize


def test_tokenize_drops_function_words_and_splits_hyphens():
    assert tokenize("The positive-definite matrix is SYMMETRIC.") == \
        ["positive-definite", "positive", "definite", "matrix", "symmetric"]


def test_bm25_matches_hand_computation():
    model = BM25(["convex set", "convex convex function", "graph"], k1=1.2, b=0.75)
    idf = math.log(1 + (3 - 2 + 0.5) / (2 + 0.5))
    avg = 6 / 3
    expected_first = idf * 1 * 2.2 / (1 + 1.2 * (1 - 0.75 + 0.75 * 2 / avg))
    expected_second = idf * 2 * 2.2 / (2 + 1.2 * (1 - 0.75 + 0.75 * 3 / avg))
    scores = model.scores("convex")
    assert scores[0] == pytest.approx(expected_first)
    assert scores[1] == pytest.approx(expected_second)
    assert scores[2] == 0


def test_rrf_rewards_agreement_and_breaks_ties_by_first_appearance():
    fused = rrf([[5, 1], [1, 7]])
    assert fused[0] == 1                         # in both lists
    assert rrf([[3], [4]]) == [3, 4]             # equal scores: first seen wins
    assert rrf([[3], [4]], weights=[1, 2]) == [4, 3]


def test_hybrid_finds_lexical_and_dense_matches():
    items = [{"text": "A matrix is positive definite if x'Qx > 0.", "page": 1},
             {"text": "Gradient descent moves against the gradient.", "page": 2},
             {"text": "Unrelated text about payment systems.", "page": 3}]
    vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    retriever = HybridRetriever(items, vectors)
    ranked = retriever.rankings("positive definite matrix", [0, 1, 0])
    assert ranked["bm25"] == [0]                 # only item 0 shares terms
    assert ranked["dense"][0] == 1
    top = retriever.search("positive definite matrix", [0, 1, 0], top_k=2)
    assert {item["page"] for item in top} == {1, 2}


def test_hybrid_eval_counts_concept_hits_at_their_page():
    import numpy as np
    from ml.eval.hybrid_eval import evaluate, summarise
    passages = {"a.pdf": [{"text": "Unrelated introduction.", "page": 1}, {"text": "More unrelated text.", "page": 2}]}
    concepts = {"a.pdf": [{"text": "orthogonal complement The orthogonal complement of W.", "page": 7, "concept": True}]}
    encode = lambda texts: np.array([[1.0, float("orthogonal" in t.lower())] for t in texts])
    questions = [{"qid": "q1", "file": "a.pdf", "split": "train", "question": "What is an orthogonal complement?",
                  "answer_pages": [7]}]
    rows = evaluate(questions, passages, concepts, encode)
    assert rows[0]["hybrid"]["recall_at_5"] == 0.0           # page 7 exists only as a concept
    assert rows[0]["hybrid_concepts"]["recall_at_5"] == 1.0
    assert rows[0]["concepts_in_top5"] == 1
    assert summarise(rows)["hybrid_concepts"]["recall_at_5"]["value"] == 1.0
