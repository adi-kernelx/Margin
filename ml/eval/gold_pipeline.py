"""ML2.15: second milestone read of the frozen test sample with the ML2.14 pipeline.

Frozen pipeline (chosen on development data in ML2.14):
  headed block   -> heading rule;
  unheaded block -> sentence detector D2 (emphasis on, no LaTeX positives) says
                    "definition" when its best sentence scores >= 0.4;
                    otherwise variant C (stacked LightGBM + reliable negatives)
                    assigns the role, with its own "definition" demoted to other.

Reference: the ML2.13 pipeline (heading rule, else stacked LightGBM trained on
headed rows only), refitted here so both read the same blocks.

Two targets are scored:
  * the seven-role labels (merged scheme), as in ML2.13;
  * contains_definition: does the block contain a sentence defining a named
    term or symbol? This is what the knowledge bundle needs.

This is the SECOND read of the frozen test set and is reported as such. It
refuses to run without --frozen-test-milestone.
"""

import argparse
import json
from pathlib import Path

from ml.eval.classifier_cv import source_weights
from ml.eval.gold_eval import SCHEMES, build_rows, cohen_kappa, evaluate, load_labels, read_jsonl
from ml.eval.prose_definition_cv import training_sentences
from ml.eval.stats import cluster_bootstrap
from ml.eval.unheaded_cv import block_row, negative_pool, sample_negatives
from ml.models.definition_features import attach_context, fit_stacked_lightgbm
from ml.models.prose_definitions import fit_sentence_detector

THRESHOLD = 0.4


def binary_scores(items, key):
    """Precision/recall of items[key] (bool) against items['contains'] with file intervals."""
    def precision(s):
        chosen = [i for i in s if i[key]]
        return sum(i["contains"] for i in chosen) / len(chosen) if chosen else None

    def recall(s):
        positives = [i for i in s if i["contains"]]
        return sum(i[key] for i in positives) / len(positives) if positives else None
    p, r = precision(items), recall(items)
    return {"blocks": len(items), "positives": sum(i["contains"] for i in items),
            "precision": p, "precision_ci95": cluster_bootstrap(items, precision)["ci95"],
            "recall": r, "recall_ci95": cluster_bootstrap(items, recall)["ci95"],
            "f1": 2 * p * r / (p + r) if p and r else 0.0}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gold", type=Path, default=Path("ml/labels/gold_labels.jsonl"))
    parser.add_argument("--sample", type=Path, default=Path("ml/labels/to_label.jsonl"))
    parser.add_argument("--train-rows", type=Path, default=Path("ml/out/arxiv_expansion/train_blocks.jsonl"))
    parser.add_argument("--context-blocks", type=Path, default=Path("ml/out/arxiv_expansion/context_blocks.jsonl"))
    parser.add_argument("--test-blocks", type=Path, nargs="+",
                        default=[Path("ml/out/full/blocks_sample.jsonl"), Path("ml/out/levin/blocks_sample.jsonl")])
    parser.add_argument("--emphasis-train", type=Path, default=Path("ml/out/ml214/emphasis_train.jsonl"))
    parser.add_argument("--emphasis-test", type=Path, default=Path("ml/out/ml214/emphasis_test_sources.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("ml/results/gold_ml215_pipeline.json"))
    parser.add_argument("--frozen-test-milestone", action="store_true")
    args = parser.parse_args()
    if not args.frozen_test_milestone:
        parser.error("Refusing to read the frozen test set without --frozen-test-milestone")

    sample = read_jsonl(args.sample)
    gold_rows = read_jsonl(args.gold)
    gold = load_labels([{"block_id": r["block_id"], "label": r["label"]} for r in gold_rows], {r["block_id"] for r in sample})
    contains = {r["block_id"]: r["contains_definition"] for r in gold_rows}
    test_blocks = [b for path in args.test_blocks for b in read_jsonl(path)]
    rows = build_rows(sample, gold, {b["block_id"]: b for b in test_blocks}, "merged")
    mapping = SCHEMES["merged"][0]
    train = [{**r, "label": mapping(r["label"])} for r in read_jsonl(args.train_rows)]
    context = read_jsonl(args.context_blocks)
    test_groups = set(json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))["test_groups"])
    if {r["group"] for r in train} & test_groups or {b["group"] for b in context} & test_groups:
        raise ValueError("Training data contains a frozen test group")
    terms_train = {x["block_id"]: x["emphasis"] for x in read_jsonl(args.emphasis_train)}
    terms_test = {x["block_id"]: x["emphasis"] for x in read_jsonl(args.emphasis_test)}
    folds = {r["group"]: r["fold"] for r in train}
    groups = set(folds)
    attach = lambda items, blocks: attach_context(items, blocks)

    # Reference: ML2.13 stacked model on headed rows only.
    headed = attach(train, context)
    reference = fit_stacked_lightgbm(headed, [r["label"] for r in headed], sample_weight=source_weights(headed))
    # Variant C: plus reliable negatives from every training source.
    counts = {}
    for r in train:
        counts[r["group"]] = counts.get(r["group"], 0) + 1
    pool = negative_pool(context, folds, set(), "reliable_negatives")
    negatives = attach([{**block_row(b), "label": "other"} for b in sample_negatives(pool, counts, groups)], context)
    data = headed + negatives
    variant_c = fit_stacked_lightgbm(data, [r["label"] for r in data], sample_weight=source_weights(data))
    # Detector D2: no LaTeX positives, emphasis on.
    sentences = training_sentences(train, context, [], terms_train, groups, set(), False, True, folds)
    detector = fit_sentence_detector([s[0] for s in sentences], [s[1] for s in sentences], [s[2] for s in sentences],
                                     sample_weight=source_weights([{"group": s[3]} for s in sentences]))

    test_rows = attach(rows, test_blocks)
    reference_pred = reference.predict(test_rows)
    c_pred = variant_c.predict(test_rows)
    items = []
    for row, ref, c in zip(rows, reference_pred, c_pred):
        score = detector.block_score(row, terms_test.get(row["block_id"], []))
        detected = score >= THRESHOLD
        row["classifier"] = c
        row["two_stage"] = row["heading"] if row["heading"] is not None else (
            "definition" if detected else ("other" if c == "definition" else c))
        row["reference"] = row["heading"] if row["heading"] is not None else ref
        items.append({"file": row["file"], "headed": row["heading"] is not None, "contains": contains[row["block_id"]],
                      "pipeline": row["two_stage"] == "definition", "reference": row["reference"] == "definition",
                      "detector": detected, "score": score})

    report = {"read": "second milestone read of the frozen test set", "threshold": THRESHOLD,
              "train_rows": len(train), "reliable_negatives": len(negatives),
              "detector_training_sentences": {"positive": sum(s[2] for s in sentences),
                                              "negative": sum(1 - s[2] for s in sentences)},
              "roles_pipeline": evaluate(rows, "merged")}
    reference_rows = [{**r, "two_stage": r["reference"]} for r in rows]
    report["roles_reference_ml213"] = evaluate(reference_rows, "merged")
    unheaded = [i for i in items if not i["headed"]]
    report["contains_definition"] = {
        "all_blocks_pipeline": binary_scores(items, "pipeline"),
        "all_blocks_reference_ml213": binary_scores(items, "reference"),
        "unheaded_detector": binary_scores(unheaded, "detector"),
        "unheaded_reference_ml213": binary_scores(unheaded, "reference")}
    report["detector_curve_unheaded"] = []
    for t in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        for i in unheaded:
            i["at"] = i["score"] >= t
        s = binary_scores(unheaded, "at")
        report["detector_curve_unheaded"].append({"threshold": t, "precision": s["precision"], "recall": s["recall"]})
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for name, values in report["contains_definition"].items():
        print(f"{name:28} P {values['precision']} R {values['recall']} F1 {values['f1']:.3f} "
              f"(positives {values['positives']} of {values['blocks']})")
    for name in ("roles_pipeline", "roles_reference_ml213"):
        r = report[name]
        print(f"{name:28} accuracy {r['two_stage']['accuracy']:.3f} macro F1 {r['two_stage']['macro_f1']:.3f}")


if __name__ == "__main__":
    main()
