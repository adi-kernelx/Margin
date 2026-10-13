"""ML2.14 development sampling and the unheaded-prose variant harness (toy data only)."""

import pytest

from ml.data.sample_dev_unheaded import sample
from ml.eval.unheaded_cv import negative_pool, run, sample_negatives, summarise


def block(block_id, group, text="Ordinary discussion of the method used in this section.", weak=None):
    return {"block_id": block_id, "group": group, "file": group + ".pdf", "page": 1, "block_index": 0,
            "text": text, "weak_label": weak, "category": "paper", "flags": [],
            "bold_ratio": 0.0, "font_size_rel": 1.0, "indent_rel": 0.0, "math_char_ratio": 0.0, "gap_above_rel": 0.0}


def test_dev_sample_rejects_test_groups_and_fills_four_cells():
    blocks = []
    for g in ("arxiv-2512.1", "arxiv-2512.2", "orig-a", "orig-b"):
        for i in range(6):
            blocks.append(block(f"{g}-p{i}", g, "A graph is called bipartite when it splits into two parts."))
            blocks.append(block(f"{g}-o{i}", g))
    folds = {"arxiv-2512.1": 0, "arxiv-2512.2": 1, "orig-a": 2, "orig-b": 3}
    rows, meta = sample(blocks, folds, ["held-out"], size=8)
    assert len(rows) == 8 and {(m["origin"], m["stratum"]) for m in meta} == {
        ("arxiv", "prose"), ("arxiv", "other"), ("original", "prose"), ("original", "other")}
    assert set(rows[0]) == {"block_id", "file", "page", "text"}
    with pytest.raises(ValueError):
        sample(blocks, folds, ["orig-a"], size=8)


def test_negative_pools_exclude_headed_dev_and_cue_blocks():
    blocks = [block("h", "g", weak="theorem"), block("d", "g"), block("n", "g"),
              block("cue", "g", "We say a set is called open if it is a union of balls.")]
    folds = {"g": 0}
    assert negative_pool(blocks, folds, {"d"}, "headed_only") == {}
    naive = [b["block_id"] for b in negative_pool(blocks, folds, {"d"}, "unlabelled_other")["g"]]
    reliable = [b["block_id"] for b in negative_pool(blocks, folds, {"d"}, "reliable_negatives")["g"]]
    assert sorted(naive) == ["cue", "n"] and reliable == ["n"]


def test_negative_sampling_is_per_source_and_deterministic():
    pool = {"g1": [block(f"a{i}", "g1") for i in range(10)], "g2": [block(f"b{i}", "g2") for i in range(10)]}
    first = sample_negatives(pool, {"g1": 3, "g2": 1}, {"g1", "g2"})
    assert [b["group"] for b in first].count("g1") == 3 and [b["group"] for b in first].count("g2") == 1
    assert first == sample_negatives(pool, {"g1": 3, "g2": 1}, {"g1", "g2"})


def test_run_never_trains_on_the_dev_blocks_source():
    rows, blocks = [], []
    for fold in range(5):
        g = f"g{fold}"
        for label in ("definition", "proof"):
            rows.append({"block_id": f"{g}-{label}", "group": g, "file": g + ".pdf", "fold": fold, "label": label,
                         "text": "x", "category": "paper", "features": {}})
        blocks += [block(f"{g}-u{i}", g) for i in range(3)]
    dev = [{"block_id": f"g{f}-u0", "label": "other"} for f in range(5)]
    seen = []

    class Model:
        classes = ["definition", "other", "proof"]

        def __init__(self, data):
            self.groups = {r["group"] for r in data}

        def predict_proba(self, held):
            assert not self.groups & {r["group"] for r in held}
            return [[0.2, 0.7, 0.1] for _ in held]

    def fit(data, labels, sample_weight):
        assert len(sample_weight) == len(data)
        seen.append({r["block_id"] for r in data})
        return Model(data)

    out = run(rows, blocks, dev, fit, lambda items: items, variants=("unlabelled_other",))
    assert all(not ({d["block_id"] for d in dev} & ids) for ids in seen)
    assert len(out["unlabelled_other"]["dev"]) == 5 and len(out["unlabelled_other"]["headed"]) == 10
    report = summarise(out, resamples=20)["unlabelled_other"]
    assert report["dev_unheaded"]["accuracy"] == 1 and report["dev_unheaded"]["definition_recall"] is None
