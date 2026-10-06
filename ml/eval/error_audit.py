"""Reproducible train-development error sample; diagnoses are not gold labels."""

import argparse
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

from ml.data.make_splits import LABELS
from ml.eval.validate_questions import group_splits

REASONS = {"rare_class", "fragment", "mixed_role", "semantic_confusion", "weak_label_suspect", "extraction_noise", "context_needed"}


def apply_reviews(selected, summary, reviews):
    """Bind local provisional notes to the exact ordered sample, never alter labels."""
    digest = hashlib.sha256("\n".join(r["block_id"] for r in selected).encode()).hexdigest()
    notes = reviews.get("notes", [])
    if reviews.get("sample_sha256") != digest or len(notes) != len(selected):
        raise ValueError("Reviews do not match the exact complete sample")
    seen = set()
    for note in notes:
        index = note.get("index")
        if type(index) is not int or index not in range(len(selected)) or index in seen:
            raise ValueError("Invalid or duplicate review index")
        if note.get("reason") not in REASONS or not isinstance(note.get("note"), str) or not note["note"].strip():
            raise ValueError("Need a known reason and nonempty review note")
        seen.add(index)
    # Validate all notes before modifying any row.
    for note in notes:
        selected[note["index"]].update(review_status="provisional_text_review",
                                      review_reason=note["reason"], review_note=note["note"])
    summary["reviewed_count"] = len(notes)
    summary["review_by_reason"] = dict(sorted(Counter(note["reason"] for note in notes).items()))
    summary["review_warning"] = "Text-only diagnostic judgments, not PDF-page verification or independent gold labels."


def audit_errors(rows, predictions, split, method="logistic", count=50, seed=20261006):
    if type(count) is not int or count < 1:
        raise ValueError("Need a positive integer sample size")
    routes = group_splits(split)
    indexed = {r["block_id"]: r for r in rows}
    if len(indexed) != len(rows) or len(predictions) != len(rows):
        raise ValueError("Need unique rows and one prediction per row")
    seen, errors = set(), []
    for prediction in predictions:
        block_id = prediction["block_id"]
        row = indexed.get(block_id)
        if row is None or block_id in seen:
            raise ValueError("Duplicate or unknown prediction ID")
        seen.add(block_id)
        if routes.get(row["group"]) != "train":
            raise ValueError("Audit accepts frozen training sources only")
        if (prediction["file"], prediction["fold"], prediction["gold"]) != (row["file"], row["fold"], row["label"]):
            raise ValueError("Prediction does not match its training row")
        if prediction.get(method) not in LABELS:
            raise ValueError("Unknown predicted label or method")
        if prediction[method] != row["label"]:
            errors.append((row, prediction))
    bins = defaultdict(list)
    for row, prediction in sorted(errors, key=lambda pair: pair[0]["block_id"]):
        bins[row["label"], row["fold"]].append((row, prediction))
    rng = random.Random(seed)
    keys = sorted(bins)
    for key in keys:
        rng.shuffle(bins[key])
    selected = []
    # Round-robin class/fold buckets: diagnostic coverage, not a random error rate.
    while len(selected) < count and any(bins.values()):
        for key in keys:
            if bins[key] and len(selected) < count:
                row, prediction = bins[key].pop()
                train = [r for r in rows if r["fold"] != row["fold"]]
                support = sum(r["label"] == row["label"] for r in train)
                words = set(row["text"].lower().split())
                vocabulary = {word for r in train for word in r["text"].lower().split()}
                selected.append({"block_id": row["block_id"], "file": row["file"], "page": row.get("page"),
                                 "fold": row["fold"], "weak_label": row["label"], "predicted": prediction[method],
                                 "text": row["text"], "train_class_support": support,
                                 "unseen_whitespace_token_fraction": len(words-vocabulary)/len(words) if words else 0,
                                 "review_status": "pending", "review_note": ""})
    summary = {"method": method, "seed": seed, "rows": len(rows), "errors": len(errors),
               "sample_count": len(selected), "requested_count": count,
               "sample_by_class": dict(sorted(Counter(r["weak_label"] for r in selected).items())),
               "sample_by_fold": dict(sorted(Counter(r["fold"] for r in selected).items())),
               "sample_missing_train_class": sum(r["train_class_support"] == 0 for r in selected),
               "weak_label_evaluation": True, "test_evaluated": False,
               "warning": "Class/fold-covered diagnostic sample; not prevalence or independent gold evidence."}
    return selected, summary


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", default="ml/out/ml2/train_blocks.jsonl")
    parser.add_argument("--predictions", default="ml/out/ml2/cv_layout_predictions.jsonl")
    parser.add_argument("--reviews", type=Path, default=Path("ml/out/ml2/error_audit_review.json"))
    args = parser.parse_args()
    split = json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))
    selected, summary = audit_errors(read_jsonl(args.rows), read_jsonl(args.predictions), split)
    if args.reviews.exists():
        apply_reviews(selected, summary, json.loads(args.reviews.read_text(encoding="utf-8")))
    out = Path("ml/out/ml2/error_audit.jsonl")
    out.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in selected), encoding="utf-8")
    Path("ml/results/error_audit_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
