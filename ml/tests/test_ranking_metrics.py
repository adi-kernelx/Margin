"""Hand-computed page nDCG and evaluator integration; no real models/data."""

import importlib
import itertools
import math

import numpy as np
import pytest

from ml.eval.metrics import METRICS, metrics
from ml.ranking.features import FEATURES


def ranked(*pages):
    return [{"page": page} for page in pages]


def test_ndcg_ideal_and_missing_gold_pages():
    assert metrics(ranked(1, 2), [1, 2])["ndcg_at_10"] == 1.0
    assert metrics(ranked(1), [1, 2])["ndcg_at_10"] == pytest.approx(1 / (1 + 1 / math.log2(3)))
    assert metrics(ranked(1), [1, 1])["ndcg_at_10"] == 1.0


def test_duplicates_get_no_extra_credit_and_do_not_compress_ranks():
    expected = 1.5 / (1 + 1 / math.log2(3))
    result = metrics(ranked(1, 1, 2), [1, 2])
    assert result["ndcg_at_10"] == pytest.approx(expected)
    assert metrics(ranked(1, 1, 1), [1])["ndcg_at_10"] == 1.0
    assert metrics(ranked(9, 9, 1), [1])["ndcg_at_10"] == 0.5


def test_ndcg_cutoff_is_candidate_rank_ten():
    assert metrics(ranked(*([9] * 9), 1), [1])["ndcg_at_10"] == pytest.approx(1 / math.log2(11))
    assert metrics(ranked(*([9] * 10), 1), [1])["ndcg_at_10"] == 0.0
    assert metrics(ranked(*range(1, 12)), list(range(1, 12)))["ndcg_at_10"] == 1.0


@pytest.mark.parametrize("items,gold", [([], [1]), (ranked(9), [1]), (ranked(1), []), ([], [])])
def test_empty_and_no_relevant_candidates(items, gold):
    assert metrics(items, gold) == dict.fromkeys(METRICS, 0.0)


def test_page_ndcg_is_bounded_with_repeated_candidates():
    for pages in itertools.product((1, 2, 9), repeat=4):
        assert 0.0 <= metrics(ranked(*pages), [1, 2])["ndcg_at_10"] <= 1.0


@pytest.mark.parametrize("module_name", ["ranker_eval", "live_rag_eval", "hybrid_eval"])
def test_reports_include_document_bootstrap_and_paired_ndcg(module_name):
    module = importlib.import_module("ml.eval." + module_name)
    baseline = getattr(module, "BASELINE", "dense")
    rows = []
    for file, base in (("a", 0.2), ("b", 0.4)):
        row = {"file": file}
        for method in module.METHODS:
            row[method] = {metric: base + (0.0 if method == baseline else 0.1) for metric in METRICS}
        rows.append(row)
    report = module.summarise(rows)
    assert report[baseline]["ndcg_at_10"]["value"] == pytest.approx(0.3)
    assert report[baseline]["ndcg_at_10"]["ci95"] == [0.2, 0.4]
    other = next(method for method in module.METHODS if method != baseline)
    paired = report["paired_vs_" + baseline][other]["ndcg_at_10"]
    assert paired["value"] == pytest.approx(0.1)
    assert paired["ci95"] == pytest.approx([0.1, 0.1])
    assert paired["documents"] == 2 and paired["questions"] == 2


def test_cross_validation_keeps_documents_separate_and_scores_ndcg(monkeypatch):
    from ml.eval import ranker_eval
    import sklearn.pipeline

    fitted = []

    class Booster:
        def feature_importance(self, kind):
            return np.ones(len(FEATURES))

    class Ranker:
        booster_ = Booster()

        def predict(self, features):
            return features[:, 0]

    class Pointwise:
        def fit(self, x, y):
            return self

        def predict_proba(self, features):
            probabilities = np.arange(len(features)) / len(features)
            return np.column_stack((1 - probabilities, probabilities))

    def train(groups):
        fitted.append({group["file"] for group in groups})
        return Ranker()

    monkeypatch.setattr(ranker_eval, "train", train)
    monkeypatch.setattr(sklearn.pipeline, "make_pipeline", lambda *steps: Pointwise())
    features = []
    for i in range(4):
        row = [0.0] * len(FEATURES)
        row[0] = row[FEATURES.index("cross_encoder")] = float(i)
        row[FEATURES.index("fused_rank_inverse")] = 1 / (i + 1)
        features.append(row)
    groups = [{"qid": file, "file": file, "pages": [9, 2, 2, 3], "answer_pages": [2, 3],
               "features": features, "labels": [0, 1, 2, 2]} for file in ("a", "b")]
    rows, _ = ranker_eval.cross_validate(groups)
    assert fitted == [{"b"}, {"a"}]
    for row in rows:
        assert row["lambdarank"]["ndcg_at_10"] == 1.0
        assert row["fused"]["ndcg_at_10"] == pytest.approx(
            (1 / math.log2(3) + 1 / math.log2(5)) / (1 + 1 / math.log2(3)))
        assert set(row["cross_encoder"]) == set(METRICS)
