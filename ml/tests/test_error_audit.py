"""Diagnostic sampling and review binding without held-out leakage."""
import hashlib
import pytest
from ml.eval.error_audit import audit_errors, apply_reviews
from ml.tests.test_classifier_cv import data


def fixture():
    rows, split, _ = data()
    predictions = [{"block_id": r["block_id"], "file": r["file"], "fold": r["fold"],
                    "gold": r["label"], "logistic": "theorem"} for r in rows]
    return rows, predictions, split


def test_sample_reproducible_complete_and_no_input_mutation():
    rows, predictions, split = fixture()
    result = audit_errors(rows, predictions, split)
    assert result == audit_errors(list(reversed(rows)), list(reversed(predictions)), split)
    sample, summary = result
    assert len(sample) == summary["errors"] == 5
    assert len({r["block_id"] for r in sample}) == 5
    assert all(r["review_status"] == "pending" for r in sample)
    assert "review_status" not in rows[0]


@pytest.mark.parametrize("fault", ["heldout", "duplicate", "unknown", "mismatch", "method", "count"])
def test_bad_audit_inputs_rejected(fault):
    rows, predictions, split = fixture()
    if fault == "heldout": split["train_groups"].remove("g0")
    elif fault == "duplicate": predictions[1] = predictions[0]
    elif fault == "unknown": predictions[0]["block_id"] = "missing"
    elif fault == "mismatch": predictions[0]["gold"] = "other"
    elif fault == "method": predictions[0]["logistic"] = "invalid"
    with pytest.raises(ValueError):
        audit_errors(rows, predictions, split, count=0 if fault == "count" else 50)


def test_no_errors_returns_empty_sample():
    rows, predictions, split = fixture()
    for row in predictions: row["logistic"] = row["gold"]
    sample, summary = audit_errors(rows, predictions, split)
    assert sample == [] and summary["errors"] == 0


def test_reviews_validate_atomically_and_bind_exact_sample():
    sample, summary = audit_errors(*fixture())
    reviews = {"sample_sha256": hashlib.sha256("\n".join(r["block_id"] for r in sample).encode()).hexdigest(),
               "notes": [{"index": i, "reason": "fragment", "note": "Context needed"} for i in range(len(sample))]}
    reviews["notes"][-1]["reason"] = "invalid"
    with pytest.raises(ValueError): apply_reviews(sample, summary, reviews)
    assert all(r["review_status"] == "pending" for r in sample)
    reviews["notes"][-1]["reason"] = "fragment"
    apply_reviews(sample, summary, reviews)
    assert summary["reviewed_count"] == 5
    assert all(r["review_status"] == "provisional_text_review" for r in sample)
    reviews["sample_sha256"] = "stale"
    with pytest.raises(ValueError): apply_reviews(sample, summary, reviews)
