"""ML2.8 merged labels, estimability rule and restricted macro F1."""

import pytest

from ml.eval.classifier_cv import classification_metrics, summarise_predictions
from ml.eval.label_scheme import MERGED_LABELS, class_coverage, merge_label, merge_rows, scored_labels


def test_notation_merges_into_definition_and_others_unchanged():
    assert merge_label("notation") == "definition"
    assert merge_label("other") == "other"
    assert "notation" not in MERGED_LABELS and len(MERGED_LABELS) == 6
    with pytest.raises(ValueError):
        merge_label("lemma")


def test_merge_rows_copies_inputs():
    rows = [{"label": "notation", "group": "g"}]
    merged = merge_rows(rows)
    assert merged[0]["label"] == "definition" and rows[0]["label"] == "notation"


def test_class_in_one_fold_is_not_estimable_even_with_many_sources():
    rows = [{"label": "algorithm", "group": f"a{i}", "fold": 3} for i in range(4)]
    rows += [{"label": "proof", "group": f"p{i}", "fold": i} for i in range(3)]
    rows += [{"label": "other", "group": f"o{i}", "fold": i} for i in range(3)]
    coverage = class_coverage(rows)
    assert coverage["algorithm"] == {"rows": 4, "sources": 4, "folds": 1, "estimable": False}
    assert coverage["proof"]["estimable"] and coverage["theorem"]["rows"] == 0
    # other is estimable but deliberately excluded from the average
    assert scored_labels(coverage) == ("proof",)


def test_macro_f1_averages_only_scored_classes():
    gold = ["proof", "proof", "algorithm"]
    predicted = ["proof", "proof", "proof"]
    full = classification_metrics(gold, predicted, MERGED_LABELS)
    restricted = classification_metrics(gold, predicted, MERGED_LABELS, scored=("proof",))
    assert restricted["macro_f1"] == pytest.approx(0.8)
    assert full["macro_f1"] == pytest.approx(0.8 / 6)
    assert restricted["per_class"]["algorithm"]["recall"] == 0  # still reported
    with pytest.raises(ValueError):
        classification_metrics(gold, predicted, MERGED_LABELS, scored=("notation",))
    with pytest.raises(ValueError):
        classification_metrics(["notation"], ["notation"], MERGED_LABELS)


def test_bootstrap_uses_merged_label_set():
    predictions = [{"file": "a", "gold": "proof", "majority": "proof", "logistic": "proof"},
                   {"file": "b", "gold": "definition", "majority": "proof", "logistic": "definition"}]
    report = summarise_predictions(predictions, 50, labels=MERGED_LABELS, scored=("proof", "definition"))
    assert report["logistic"]["macro_f1"] == 1
    assert set(report["logistic"]["ci95"]) == {"accuracy", "macro_f1", *MERGED_LABELS}
