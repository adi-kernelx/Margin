"""ML2.9 gold evaluation on toy data only: never reads the frozen test sample."""

import pytest

from ml.eval.gold_eval import build_rows, cohen_kappa, evaluate, load_labels
from ml.eval.stats import cluster_bootstrap


def test_kappa_hand_values():
    assert cohen_kappa(list("aabb"), list("aabb")) == 1
    # observed 0.5, chance 0.5 -> no agreement beyond chance
    assert cohen_kappa(list("aabb"), list("abab")) == pytest.approx(0)
    # observed 0.75; marginals a 2/4, b 2/4 vs a 3/4, b 1/4 -> chance 0.5
    assert cohen_kappa(list("aabb"), list("aaab")) == pytest.approx(0.5)
    with pytest.raises(ValueError):
        cohen_kappa(["a"], [])


def test_load_labels_rejects_foreign_duplicate_and_unknown():
    ids = {"b1", "b2"}
    assert load_labels([{"block_id": "b1", "label": "notation"}], ids) == {"b1": "notation"}
    for bad in ([{"block_id": "zz", "label": "proof"}], [{"block_id": "b1", "label": "lemma"}],
                [{"block_id": "b1", "label": "proof"}, {"block_id": "b1", "label": "proof"}]):
        with pytest.raises(ValueError):
            load_labels(bad, ids)


def block(block_id, file, weak=None, text="Some body text that is long enough."):
    return {"block_id": block_id, "file": file, "group": "g" + file, "weak_label": weak,
            "text": text, "text_without_heading": text, "category": "paper",
            "bold_ratio": 0, "font_size_rel": 1, "indent_rel": 0, "math_char_ratio": 0, "gap_above_rel": 0}


def toy_rows(scheme="merged"):
    blocks = {b["block_id"]: b for b in [
        block("h1", "A", "theorem"), block("h2", "A", "proof"),
        block("p1", "B", None, "We say a graph is bipartite if it splits."),
        block("p2", "C", None, "A set is called open if it is a union of balls."),
        block("u1", "C", None, "Background discussion of earlier work."),
    ]}
    sample = [{"block_id": key} for key in blocks]
    gold = {"h1": "theorem", "h2": "proof", "p1": "definition", "p2": "notation", "u1": "other"}
    rows = build_rows(sample, gold, blocks, scheme)
    predicted = {"h1": "theorem", "h2": "theorem", "p1": "definition", "p2": "other", "u1": "other"}
    for row in rows:
        row["classifier"] = predicted[row["block_id"]]
        row["two_stage"] = row["heading"] or row["classifier"]
    return rows


def test_build_rows_maps_scheme_and_strata():
    rows = {row["block_id"]: row for row in toy_rows()}
    assert rows["p2"]["gold"] == "definition" and rows["p2"]["gold_raw"] == "notation"
    assert rows["h1"]["stratum"] == "weak" and rows["p1"]["stratum"] == "prose" and rows["u1"]["stratum"] == "unlabelled"
    coarse = {row["block_id"]: row for row in toy_rows("coarse")}
    assert coarse["h2"]["gold"] == "other" and coarse["h2"]["heading"] == "other"


def test_two_stage_uses_heading_and_prose_recall_counts_only_unheaded():
    report = evaluate(toy_rows(), "merged", resamples=50)
    assert report["heading_rule"]["coverage"] == pytest.approx(2 / 5)
    assert report["heading_rule"]["accuracy_when_it_fires"] == 1
    # heading corrects the classifier's proof mistake
    assert report["two_stage"]["accuracy"] == pytest.approx(4 / 5)
    assert report["classifier"]["accuracy"] == pytest.approx(3 / 5)
    prose = report["prose_definitions"]
    assert prose["count"] == 2 and prose["recall"] == pytest.approx(0.5)
    assert prose["precision_on_unheaded"] == 1
    assert "algorithm" not in report["macro_f1_classes"]  # no gold support


def test_cluster_bootstrap_skips_undefined_resamples():
    rows = [{"file": "a", "x": 1}, {"file": "b", "x": None}]
    out = cluster_bootstrap(rows, lambda s: (sum(r["x"] for r in s if r["x"] is not None) /
                                             len([r for r in s if r["x"] is not None]))
                            if any(r["x"] is not None for r in s) else None, resamples=200)
    assert out["ci95"] == [1, 1] and 0 < out["undefined_resamples"] < 200
