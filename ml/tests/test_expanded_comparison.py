"""Identity/fold/label guards and paired source-bootstrap arithmetic."""
import pytest
from ml.eval.compare_expanded import paired_differences


def data():
    rows = [{"block_id": str(i), "file": f"f{i}", "group": f"g{i // 2}", "fold": i // 2,
             "label": "definition"} for i in range(4)]
    old = [{**row, "gold": "definition", "logistic": "proof"} for row in rows]
    new = [{**row, **{method: "definition" for method in
                    ("balanced_logistic", "word_char_logistic", "cue_logistic", "stacked_lightgbm")}} for row in old]
    return rows, old, new


def test_hand_checked_paired_differences():
    report = paired_differences(*data(), resamples=20)
    assert report == paired_differences(*data(), resamples=20)
    assert report["cue_logistic"]["definition_recall"]["delta"] == 1
    assert report["stacked_lightgbm"]["accuracy"]["ci95"] == [1, 1]


@pytest.mark.parametrize("fault", ["missing", "duplicate", "fold", "file", "label", "baseline"])
def test_changed_comparison_rejected(fault):
    rows, old, new = data()
    if fault == "missing": new.pop()
    elif fault == "duplicate": new.append(new[0])
    elif fault == "fold": new[0]["fold"] = 4
    elif fault == "file": new[0]["file"] = "elsewhere"
    elif fault == "label": new[0]["gold"] = "proof"
    else: new[0]["logistic"] = "definition"
    with pytest.raises(ValueError):
        paired_differences(rows, old, new, resamples=20)
