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


def classification_metrics(gold, predicted, labels=LABELS, scored=None):
    """Per-class metrics over `labels`; macro F1 averages only `scored` classes.

    `scored` defaults to every label (the original seven-class macro F1).
    """
    scored = tuple(labels) if scored is None else tuple(scored)
    if not gold or len(gold) != len(predicted):
        raise ValueError("Need equally sized nonempty gold/prediction lists")
    if not scored or set(scored) - set(labels):
        raise ValueError("Scored classes must be a nonempty subset of labels")
    pairs = Counter(zip(gold, predicted))
    if any(a not in labels or b not in labels for a, b in pairs):
        raise ValueError("Unknown class in metrics")
    matrix = [[pairs[a,b] for b in labels] for a in labels]
    classes = {}
    for index, label in enumerate(labels):
        tp = matrix[index][index]
        support = sum(matrix[index])
        guessed = sum(row[index] for row in matrix)
        precision = tp / guessed if guessed else 0.0
        recall = tp / support if support else 0.0
        classes[label] = {"precision": precision, "recall": recall,
                          "f1": 2*tp/(support+guessed) if support+guessed else 0.0,
                          "support": support}
    return {"accuracy": sum(matrix[i][i] for i in range(len(labels)))/len(gold),
            "macro_f1": sum(classes[label]["f1"] for label in scored)/len(scored),
            "per_class": classes, "confusion_matrix": matrix,
            "missing_gold_classes": [label for label in labels if classes[label]["support"] == 0]}


def source_weights(rows):
    """Equal total influence per usable source, normalized to mean one per fit.

    Recomputed only from training rows. Never use development labels/counts.
    """
    counts = Counter(row["group"] for row in rows)
    if not counts:
        raise ValueError("Need nonempty training sources")
    scale = len(rows) / len(counts)
    return [scale / counts[row["group"]] for row in rows]


def cross_validate(rows, split, manifest, fit=fit_tfidf_classifier, fitters=None, row_fitters=None, labels=LABELS, source_weighted=False):
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
        if not isinstance(row["text"], str) or not row["text"].strip() or row["label"] not in labels:
            raise ValueError("Invalid training text/label")
    if {row["fold"] for row in rows} != set(range(5)):
        raise ValueError("All five folds need usable labelled rows")
    predictions, folds = [], []
    for fold in range(5):
        train = [row for row in rows if row["fold"] != fold]
        dev = [row for row in rows if row["fold"] == fold]
        train_labels = [row["label"] for row in train]
        weights = source_weights(train) if source_weighted else None
        baseline = majority_label(train_labels, sample_weight=weights)
        outputs = {}
        for method, fitter in {**fitters, **row_fitters}.items():
            train_input = train if method in row_fitters else [row["text"] for row in train]
            dev_input = dev if method in row_fitters else [row["text"] for row in dev]
            model = fitter(train_input, train_labels, **({"sample_weight": weights} if source_weighted else {}))
            predicted = list(model.predict(dev_input))
            if len(predicted) != len(dev) or any(label not in labels for label in predicted):
                raise ValueError("Invalid classifier output")
            outputs[method] = predicted
        folds.append({"fold": fold, "train_rows":len(train), "dev_rows":len(dev),
                      "train_groups":len({r["group"] for r in train}), "dev_groups":len({r["group"] for r in dev}),
                      "majority_label":baseline, "missing_train_classes":sorted(set(labels)-set(train_labels)),
                      "missing_dev_classes":sorted(set(labels)-{r["label"] for r in dev})})
        for index, row in enumerate(dev):
            predictions.append({"block_id":row["block_id"], "file":row["file"], "fold":fold,
                                "gold":row["label"], "majority":baseline,
                                **{method: values[index] for method, values in outputs.items()}})
    return predictions, folds


def summarise_predictions(predictions, resamples=2000, seed=20261006, labels=LABELS, scored=None):
    if not predictions or resamples < 1:
        raise ValueError("Need predictions and positive bootstrap resamples")
    clusters = defaultdict(list)
    for row in predictions:
        clusters[row["file"]].append(row)
    files = sorted(clusters)
    rng = random.Random(seed)
    methods = ("majority", "logistic") + tuple(
        name for name in ("naive_bayes", "layout_lightgbm", "balanced_logistic", "word_char_logistic",
                         "cue_logistic", "stacked_lightgbm")
        if name in predictions[0])
    summaries = {method: classification_metrics([r["gold"] for r in predictions], [r[method] for r in predictions],
                                                labels, scored)
                 for method in methods}
    distributions = {method: defaultdict(list) for method in summaries}
    for _ in range(resamples):
        sampled = [row for _ in files for row in clusters[rng.choice(files)]]
        for method in summaries:
            scores = classification_metrics([r["gold"] for r in sampled], [r[method] for r in sampled], labels, scored)
            for metric in ("accuracy", "macro_f1"):
                distributions[method][metric].append(scores[metric])
            for label in labels:
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
    parser.add_argument("--split", type=Path, default=Path("ml/splits.json"))
    parser.add_argument("--manifest", type=Path, default=Path("Test PDFs/manifest.csv"))
    parser.add_argument("--source-weighted", action="store_true", help="1/source row count, normalized to mean one per training fit")
    parser.add_argument("--with-naive-bayes", action="store_true", help="Compare both models on identical folds")
    parser.add_argument("--with-layout", action="store_true", help="Add layout-only LightGBM on identical folds")
    parser.add_argument("--with-improved", action="store_true", help="Add two fixed balanced-text development candidates")
    parser.add_argument("--merged", action="store_true",
                        help="ML2.8 scheme: notation->definition; macro F1 over estimable classes, other unscored")
    parser.add_argument("--coarse", action="store_true",
                        help="3-way definition / theorem (statement) / other (neither); macro F1 over the first two")
    parser.add_argument("--with-features", action="store_true",
                        help="ML2.10: cue/context/layout logistic and stacked LightGBM (needs --context-blocks)")
    parser.add_argument("--context-blocks", type=Path, default=Path("ml/out/ml27/verified/blocks.jsonl"),
                        help="All extracted blocks of the training PDFs, for previous-block context")
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.rows.read_text(encoding="utf-8").splitlines() if line.strip()]
    labels, scored, coverage = LABELS, None, None
    if args.merged:
        from ml.eval.label_scheme import MERGE, MERGED_LABELS, MIN_FOLDS, MIN_SOURCES, UNSCORED, class_coverage, merge_rows, scored_labels
        rows = merge_rows(rows)
        coverage = class_coverage(rows)
        labels, scored = MERGED_LABELS, scored_labels(coverage)
    if args.coarse:
        if args.merged:
            parser.error("--coarse and --merged are alternative schemes")
        from ml.eval.label_scheme import COARSE, COARSE_LABELS, COARSE_SCORED, coarse_rows
        rows, labels, scored = coarse_rows(rows), COARSE_LABELS, COARSE_SCORED
    if args.with_features:
        from ml.models.definition_features import attach_context
        context_blocks = [json.loads(line) for line in args.context_blocks.read_text(encoding="utf-8").splitlines() if line.strip()]
        rows = attach_context(rows, context_blocks)
    split = json.loads(args.split.read_text(encoding="utf-8"))
    with args.manifest.open(encoding="utf-8", newline="") as source:
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
    if args.with_features:
        from ml.models.definition_features import fit_cue_logistic, fit_stacked_lightgbm
        row_fitters.update(cue_logistic=fit_cue_logistic, stacked_lightgbm=fit_stacked_lightgbm)
    predictions, folds = cross_validate(rows, split, manifest, fitters=fitters, row_fitters=row_fitters, labels=labels, source_weighted=args.source_weighted)
    report = {"weak_label_evaluation":True, "test_evaluated":False, "rows":len(rows),
              "dataset_revision": args.dataset_revision,
              "source_weighting": "1 / usable source rows; mean-one within training fold" if args.source_weighted else None,
              "documents":len({r["file"] for r in rows}), "label_order":list(LABELS),
              "seed":20261006, "bootstrap_resamples":2000, "folds":folds,
              "methods":summarise_predictions(predictions, labels=labels, scored=scored)}
    if args.merged:
        report["label_order"] = list(labels)
        report["label_scheme"] = {
            "merged": MERGE, "unscored": list(UNSCORED), "macro_f1_classes": list(scored),
            "not_estimable": [label for label, info in coverage.items() if not info["estimable"]],
            "estimable_rule": {"min_sources": MIN_SOURCES, "min_folds": MIN_FOLDS}, "coverage": coverage}
    if args.coarse:
        report["label_order"] = list(labels)
        report["label_scheme"] = {"coarse": COARSE, "macro_f1_classes": list(scored)}
    if args.with_features:
        from ml.models.definition_features import CUES, STACK_PARAMETERS, STACK_ROUNDS, INNER_FOLDS
        report["feature_configuration"] = {
            "cues": CUES, "context": "heading label of previous block in (file, page, block_index) order",
            "context_blocks": str(args.context_blocks),
            "cue_logistic": {"C": 1.0, "class_weight": "balanced", "word_ngrams": [1, 2], "hand_scaling": "standard"},
            "stacked_lightgbm": {"parameters": STACK_PARAMETERS, "rounds": STACK_ROUNDS,
                                 "inner_source_folds": INNER_FOLDS, "text_model": "balanced_logistic"}}
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
    scheme = "coarse" if args.coarse else "merged" if args.merged else ""
    suffix = "_".join(part for part in (scheme, "features" if args.with_features else "") if part) or None
    suffix = suffix if suffix else "improved" if args.with_improved else "layout" if args.with_layout else "nb" if args.with_naive_bayes else ""
    args.out = args.out or Path(f"ml/results/classifier{'_' + suffix if suffix else ''}_cv.json")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2) + "\n", encoding="utf-8")
    audit = args.audit or Path(f"ml/out/ml2/cv{'_' + suffix if suffix else ''}_predictions.jsonl")
    audit.parent.mkdir(parents=True, exist_ok=True)
    with audit.open("w",encoding="utf-8") as output:
        for row in predictions:
            output.write(json.dumps(row) + "\n")
    if args.merged and not args.coarse:
        print("Macro F1 classes:", list(scored), "| not estimable:", report["label_scheme"]["not_estimable"],
              "| unscored:", list(UNSCORED))
    for method, scores in report["methods"].items():
        print(method, "accuracy", round(scores["accuracy"],4), "macro F1", round(scores["macro_f1"],4))
        print("95% CIs:", {key:scores["ci95"][key] for key in ("accuracy","macro_f1")})
        for label, values in scores["per_class"].items():
            print(label, values)
    print("Weak-label development scores only; frozen test sources untouched.")


if __name__ == "__main__":
    main()
