"""Train-only heading-free inputs, capping and source-isolated CV folds."""

import pytest

from ml.data.prepare_training import FEATURES, prepare


def inputs():
    split = {"status":"frozen", "train_groups":["a","b","c","d","empty"], "test_groups":["held"], "excluded_groups":[]}
    blocks = []
    for group in ["a","b","c","d","held"]:
        for index in range(20):
            blocks.append({"block_id":f"{group}-{index}","group":group,"file":group + '.pdf',"page":1,
                           "text":"Theorem 1. Full text must never become the model input.",
                           "text_without_heading":"A sufficiently long mathematical statement without its heading.",
                           "weak_label":"definition" if index == 0 else "theorem","category":"paper",
                           **{key:0.1 for key in FEATURES}})
    return blocks, split


def test_heading_free_train_only_cap_and_sparse_labels():
    rows, report = prepare(*inputs(), cap=5)
    assert len(rows) == 20
    assert all(row["group"] != "held" and "Theorem 1" not in row["text"] for row in rows)
    assert report["labels"]["definition"] == 4
    assert max(report["groups"].values()) == 5


def test_disjoint_group_folds_and_determinism():
    blocks, split = inputs()
    rows, report = prepare(blocks, split)
    assert (rows,report) == prepare(blocks[::-1],split)
    groups = [group for fold in report["folds"] for group in fold["groups"]]
    assert sorted(groups) == sorted(split["train_groups"])
    assert len(groups) == len(set(groups))
    assert all(len({r["fold"] for r in rows if r["group"] == group}) <= 1 for group in groups)


def test_unlabelled_not_other_and_short_body_dropped():
    blocks, split = inputs()
    blocks[0]["weak_label"] = None
    blocks[1]["text_without_heading"] = ""
    rows, report = prepare(blocks,split)
    assert report["dropped"]["unlabelled"] == report["dropped"]["short_heading_free"] == 1
    assert not any(row["label"] == "other" for row in rows)


@pytest.mark.parametrize("fault", ["unfrozen", "overlap", "missing-body", "duplicate"])
def test_invalid_training_input_rejected(fault):
    blocks, split = inputs()
    if fault == "unfrozen": split["status"] = "proposed"
    elif fault == "overlap": split["test_groups"].append("a")
    elif fault == "missing-body": del blocks[0]["text_without_heading"]
    else: blocks.append(blocks[0])
    with pytest.raises(ValueError): prepare(blocks,split)
