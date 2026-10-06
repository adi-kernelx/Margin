"""ML2.3: train-only grouped out-of-fold evaluation against weak labels.

Not a gold test evaluation. Fit a fresh vocabulary/model for every held-out
source fold. Bootstrap files, never independent rows. Fixed candidates only;
development comparisons are not an unbiased final evaluation.
"""

import argparse
import csv
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

from ml.data.make_splits import LABELS
from ml.eval.stats import percentile
from ml.eval.validate_questions import group_splits
from ml.models.first_classifier import fit_tfidf_classifier, fit_tfidf_naive_bayes, majority_label


def classification_metrics(gold, predicted):
    if not gold or len(gold) != len(predicted):
        raise ValueError("Need equally sized nonempty gold/prediction lists")
    pairs = Counter(zip(gold, predicted))
    if any(a not in LABELS or b not in LABELS for a, b in pairs):
        raise ValueError("Unknown class in metrics")
    matrix = [[pairs[a,b] for b in LABELS] for a in LABELS]
    classes = {}
    for index, label in enumerate(LABELS):
        tp = matrix[index][index]
        support = sum(matrix[index])
        guessed = sum(row[index] for row in matrix)
        precision = tp / guessed if guessed else 0.0
        recall = tp / support if support else 0.0
        classes[label] = {"precision": precision, "recall": recall,
                          "f1": 2*tp/(support+guessed) if support+guessed else 0.0,
                          "support": support}
    return {"accuracy": sum(matrix[i][i] for i in range(len(LABELS)))/len(gold),
            "macro_f1": sum(row["f1"] for row in classes.values())/len(LABELS),
            "per_class": classes, "confusion_matrix": matrix,
            "missing_gold_classes": [label for label in LABELS if classes[label]["support"] == 0]}


def cross_validate(rows, split, manifest, fit=fit_tfidf_classifier, fitters=None, row_fitters=None):
    fitters = fitters or {"logistic": fit}
    row_fitters = row_fitters or {}
    if set(fitters) & set(row_fitters) or "majority" in set(fitters) | set(row_fitters):
        raise ValueError("Classifier method names must be distinct and not majority")
    routes = group_splits(split)
    seen, source_folds = set(), {}
    for row in rows:
        if row["block_id"] in seen:
            raise ValueError("Duplicate training block ID")
        seen.add(row["block_id"])
        if routes.get(row["group"]) != "train" or manifest.get(row["file"], {}).get("group") != row["group"]:
            raise ValueError("Row is not from the frozen training sources/manifest")
        if type(row["fold"]) is not int or row["fold"] not in range(5):
            raise ValueError("Expected fold 0..4")
        if source_folds.setdefault(row["group"], row["fold"]) != row["fold"]:
            raise ValueError("Source split across development folds")
        if not isinstance(row["text"], str) or not row["text"].strip() or row["label"] not in LABELS:
            raise ValueError("Invalid training text/label")
    if {row["fold"] for row in rows} != set(range(5)):
        raise ValueError("All five folds need usable labelled rows")
    predictions, folds = [], []
    for fold in range(5):
        train = [row for row in rows if row["fold"] != fold]
        dev = [row for row in rows if row["fold"] == fold]
        train_labels = [row["label"] for row in train]
        baseline = majority_label(train_labels)
        outputs = {}
        for method, fitter in {**fitters, **row_fitters}.items():
            train_input = train if method in row_fitters else [row["text"] for row in train]
            dev_input = dev if method in row_fitters else [row["text"] for row in dev]
            model = fitter(train_input, train_labels)
            predicted = list(model.predict(dev_input))
            if len(predicted) != len(dev) or any(label not in LABELS for label in predicted):
                raise ValueError("Invalid classifier output")
            outputs[method] = predicted
        folds.append({"fold": fold, "train_rows":len(train), "dev_rows":len(dev),
                      "train_groups":len({r["group"] for r in train}), "dev_groups":len({r["group"] for r in dev}),
                      "majority_label":baseline, "missing_train_classes":sorted(set(LABELS)-set(train_labels)),
                      "missing_dev_classes":sorted(set(LABELS)-{r["label"] for r in dev})})
        for index, row in enumerate(dev):
            predictions.append({"block_id":row["block_id"], "file":row["file"], "fold":fold,
                                "gold":row["label"], "majority":baseline,
                                **{method: values[index] for method, values in outputs.items()}})
    return predictions, folds


def summarise_predictions(predictions, resamples=2000, seed=20261006):
    if not predictions or resamples < 1:
        raise ValueError("Need predictions and positive bootstrap resamples")
    clusters = defaultdict(list)
    for row in predictions:
        clusters[row["file"]].append(row)
    files = sorted(clusters)
    rng = random.Random(seed)
    methods = ("majority", "logistic") + tuple(
        name for name in ("naive_bayes", "layout_lightgbm", "balanced_logistic", "word_char_logistic")
        if name in predictions[0])
    summaries = {method: classification_metrics([r["gold"] for r in predictions], [r[method] for r in predictions])
                 for method in methods}
    distributions = {method: defaultdict(list) for method in summaries}
    for _ in range(resamples):
        sampled = [row for _ in files for row in clusters[rng.choice(files)]]
        for method in summaries:
            scores = classification_metrics([r["gold"] for r in sampled], [r[method] for r in sampled])
            for metric in ("accuracy", "macro_f1"):
                distributions[method][metric].append(scores[metric])
            for label in LABELS:
                distributions[method][label].append(scores["per_class"][label]["f1"])
    for method, summary in summaries.items():
        summary["ci95"] = {key:[percentile(values,.025),percentile(values,.975)]
                           for key,values in distributions[method].items()}
    return summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=Path, default=Path("ml/out/ml2/train_blocks.jsonl"))
    parser.add_argument("--out", type=Path)
    parser.add_argument("--audit", type=Path, help="Separate local row-audit path for a regenerated dataset")
    parser.add_argument("--dataset-revision", default="ML2.1", help="Identify changed weak-label rows; do not compare as identical-row scores")
    parser.add_argument("--with-naive-bayes", action="store_true", help="Compare both models on identical folds")
    parser.add_argument("--with-layout", action="store_true", help="Add layout-only LightGBM on identical folds")
    parser.add_argument("--with-improved", action="store_true", help="Add two fixed balanced-text development candidates")
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.rows.read_text(encoding="utf-8").splitlines() if line.strip()]
    split = json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))
    with Path("Test PDFs/manifest.csv").open(encoding="utf-8", newline="") as source:
        manifest = {row["file"]:row for row in csv.DictReader(source)}
    fitters = {"logistic":fit_tfidf_classifier}
    if args.with_naive_bayes:
        fitters["naive_bayes"] = fit_tfidf_naive_bayes
    if args.with_improved:
        from ml.models.improved_classifier import fit_balanced_classifier, fit_word_char_classifier
        fitters.update(balanced_logistic=fit_balanced_classifier, word_char_logistic=fit_word_char_classifier)
    row_fitters = {}
    if args.with_layout:
        from ml.models.layout_classifier import fit_layout_classifier, FEATURES, PARAMETERS, ROUNDS
        row_fitters["layout_lightgbm"] = fit_layout_classifier
    predictions, folds = cross_validate(rows, split, manifest, fitters=fitters, row_fitters=row_fitters)
    report = {"weak_label_evaluation":True, "test_evaluated":False, "rows":len(rows),
              "dataset_revision": args.dataset_revision,
              "documents":len({r["file"] for r in rows}), "label_order":list(LABELS),
              "seed":20261006, "bootstrap_resamples":2000, "folds":folds,
              "methods":summarise_predictions(predictions)}
    if args.dataset_revision != "ML2.1":
        report["comparison_warning"] = "Regenerated weak-label rows; scores are not identical-row improvements over earlier reports."
    if args.with_layout:
        report["layout_configuration"] = {"numeric_features": list(FEATURES), "categorical_features": ["category"],
                                          "parameters": PARAMETERS, "rounds": ROUNDS}
    if args.with_improved:
        report["development_candidates"] = {
            "balanced_logistic": {"C": 1.0, "class_weight": "balanced", "word_ngrams": [1, 2]},
            "word_char_logistic": {"C": 1.0, "class_weight": "balanced", "word_ngrams": [1, 2],
                                   "char_analyzer": "char_wb", "char_ngrams": [3, 5], "char_min_df": 2},
            "selection_warning": "Candidates informed by development errors; not independent gold performance."}
    suffix = "improved" if args.with_improved else "layout" if args.with_layout else "nb" if args.with_naive_bayes else ""
    args.out = args.out or Path(f"ml/results/classifier{'_' + suffix if suffix else ''}_cv.json")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2) + "\n", encoding="utf-8")
    audit = args.audit or Path(f"ml/out/ml2/cv{'_' + suffix if suffix else ''}_predictions.jsonl")
    audit.parent.mkdir(parents=True, exist_ok=True)
    with audit.open("w",encoding="utf-8") as output:
        for row in predictions:
            output.write(json.dumps(row) + "\n")
    for method, scores in report["methods"].items():
        print(method, "accuracy", round(scores["accuracy"],4), "macro F1", round(scores["macro_f1"],4))
        print("95% CIs:", {key:scores["ci95"][key] for key in ("accuracy","macro_f1")})
        for label, values in scores["per_class"].items():
            print(label, values)
    print("Weak-label development scores only; frozen test sources untouched.")


if __name__ == "__main__":
    main()
