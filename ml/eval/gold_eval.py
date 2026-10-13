"""ML2.9: evaluate the block classifier against independent labels on the frozen test sample.

Three systems are compared on the 300 labelled test blocks:

- heading rule: the weak label from a formatted heading, or abstain;
- classifier: one model fitted on ALL training rows, applied to heading-free text;
- two-stage (the product): heading rule when a heading exists, else classifier.

The headline number is prose-definition recall: blocks the labeller called a
definition that have no formatted heading. The heading rule cannot find these
by construction; they are what the classifier exists for.

The sample is enriched (a third weak-labelled, a third prose-definition
candidates, a third other unlabelled), so scores are per-sample diagnostics,
not population rates. Intervals resample whole files.

Reading the frozen test set is a milestone step: the run refuses to start
without --frozen-test-milestone. --kappa-only compares two label files and reads
no model output.
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from ml.data.make_splits import LABELS
from ml.data.sample_for_labelling import PROSE
from ml.eval.classifier_cv import classification_metrics
from ml.eval.label_scheme import COARSE, COARSE_LABELS, COARSE_SCORED, MERGE, MERGED_LABELS, UNSCORED
from ml.eval.stats import cluster_bootstrap
from ml.models.layout_classifier import FEATURES as LAYOUT

SCHEMES = {
    "merged": (lambda label: MERGE.get(label, label), MERGED_LABELS,
               tuple(label for label in MERGED_LABELS if label not in UNSCORED)),
    "coarse": (COARSE.__getitem__, COARSE_LABELS, COARSE_SCORED),
}


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def load_labels(rows, sample_ids):
    """Validate an exported label file against the sample; return block_id -> raw label."""
    labels = {}
    for row in rows:
        if row.get("block_id") not in sample_ids or row.get("label") not in LABELS:
            raise ValueError(f"Foreign block or unknown label: {row!r}")
        if row["block_id"] in labels:
            raise ValueError(f"Duplicate label for {row['block_id']}")
        labels[row["block_id"]] = row["label"]
    return labels


def cohen_kappa(first, second):
    """Agreement beyond chance between two labellings of the same items.

    kappa = (p_observed - p_chance) / (1 - p_chance), where p_chance sums, over
    classes, the product of each labeller's marginal rate for that class.
    """
    if not first or len(first) != len(second):
        raise ValueError("Need two equally sized nonempty labellings")
    n = len(first)
    observed = sum(a == b for a, b in zip(first, second)) / n
    left, right = Counter(first), Counter(second)
    chance = sum(left[label] * right[label] for label in left) / (n * n)
    return 1.0 if chance == 1 else (observed - chance) / (1 - chance)


def build_rows(sample, gold, blocks_by_id, scheme):
    """Join labelled sample blocks with their extracted block data."""
    mapping = SCHEMES[scheme][0]
    rows = []
    for item in sample:
        if item["block_id"] not in gold:
            continue
        block = blocks_by_id.get(item["block_id"])
        if block is None:
            raise ValueError(f"Labelled block {item['block_id']} missing from extracted blocks")
        weak = block.get("weak_label")
        text = (block.get("text_without_heading") or "").strip() or block["text"].strip()
        rows.append({"block_id": block["block_id"], "file": block["file"], "group": block["group"],
                     "gold": mapping(gold[item["block_id"]]), "gold_raw": gold[item["block_id"]],
                     "heading": mapping(weak) if weak else None,
                     "stratum": "weak" if weak else "prose" if PROSE.search(block["text"]) else "unlabelled",
                     "text": text, "category": block["category"],
                     "features": {name: block[name] for name in LAYOUT}})
    return rows


def _recall(rows, system, label):
    positives = [row for row in rows if row["gold"] == label]
    return sum(row[system] == label for row in positives) / len(positives) if positives else None


def _precision(rows, system, label):
    guessed = [row for row in rows if row[system] == label]
    return sum(row["gold"] == label for row in guessed) / len(guessed) if guessed else None


def _accuracy(rows, system):
    covered = [row for row in rows if row[system] is not None]
    return sum(row[system] == row["gold"] for row in covered) / len(covered) if covered else None


def evaluate(rows, scheme, resamples=2000):
    """All headline numbers for rows that carry gold, heading, classifier and two_stage."""
    _, labels, scored = SCHEMES[scheme]
    present = tuple(label for label in scored if any(row["gold"] == label for row in rows))
    report = {"scheme": scheme, "blocks": len(rows), "files": len({row["file"] for row in rows}),
              "gold_counts": dict(Counter(row["gold"] for row in rows)),
              "strata": dict(Counter(row["stratum"] for row in rows)),
              "macro_f1_classes": list(present),
              "note": "Enriched sample: diagnostic rates, not population estimates."}
    covered = [row for row in rows if row["heading"] is not None]
    report["heading_rule"] = {
        "coverage": len(covered) / len(rows),
        "accuracy_when_it_fires": _accuracy(rows, "heading"),
        "accuracy_ci95": cluster_bootstrap(rows, lambda s: _accuracy(s, "heading"), resamples=resamples),
        "precision": {label: _precision(rows, "heading", label) for label in labels}}
    for system in ("classifier", "two_stage"):
        scores = classification_metrics([r["gold"] for r in rows], [r[system] for r in rows], labels, present)
        scores["accuracy_ci95"] = cluster_bootstrap(rows, lambda s: _accuracy(s, system), resamples=resamples)
        scores["macro_f1_ci95"] = cluster_bootstrap(
            rows, lambda s: classification_metrics([r["gold"] for r in s], [r[system] for r in s],
                                                   labels, present)["macro_f1"], resamples=resamples)
        report[system] = scores
    prose = [row for row in rows if row["heading"] is None]
    prose_defs = [row for row in prose if row["gold"] == "definition"]
    report["prose_definitions"] = {
        "count": len(prose_defs), "files": len({row["file"] for row in prose_defs}),
        "recall": _recall(prose, "two_stage", "definition"),
        "recall_ci95": cluster_bootstrap(prose, lambda s: _recall(s, "two_stage", "definition"), resamples=resamples),
        "precision_on_unheaded": _precision(prose, "two_stage", "definition"),
        "precision_ci95": cluster_bootstrap(prose, lambda s: _precision(s, "two_stage", "definition"),
                                            resamples=resamples),
        "heading_rule_recall": 0.0 if prose_defs else None}
    report["by_stratum_two_stage_accuracy"] = {
        name: _accuracy([row for row in rows if row["stratum"] == name], "two_stage")
        for name in sorted({row["stratum"] for row in rows})}
    return report


def predict(rows, train_rows, model_name, context_blocks=None, test_blocks=None, source_weighted=True):
    """Fit one model on all training rows and fill row['classifier'] and row['two_stage'].

    Source weights (1 / rows from that source, mean one) match how the model was
    selected in the expanded development comparison.
    """
    from ml.eval.classifier_cv import source_weights
    weights = source_weights(train_rows) if source_weighted else None
    if model_name in ("cue_logistic", "stacked_lightgbm"):
        from ml.models.definition_features import attach_context, fit_cue_logistic, fit_stacked_lightgbm
        fitter = {"cue_logistic": fit_cue_logistic, "stacked_lightgbm": fit_stacked_lightgbm}[model_name]
        train_rows = attach_context(train_rows, context_blocks)
        model = fitter(train_rows, [row["label"] for row in train_rows], sample_weight=weights)
        outputs = model.predict(attach_context(rows, test_blocks))
    else:
        from ml.models.improved_classifier import fit_balanced_classifier
        model = fit_balanced_classifier([row["text"] for row in train_rows], [row["label"] for row in train_rows],
                                        sample_weight=weights)
        outputs = list(model.predict([row["text"] for row in rows]))
    for row, label in zip(rows, outputs):
        row["classifier"] = label
        row["two_stage"] = row["heading"] if row["heading"] is not None else label
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gold", type=Path, default=Path("ml/labels/hand_labels.jsonl"))
    parser.add_argument("--sample", type=Path, default=Path("ml/labels/to_label.jsonl"))
    parser.add_argument("--compare", type=Path, help="Second label file (e.g. assistant_labels.jsonl) for Cohen's kappa")
    parser.add_argument("--kappa-only", action="store_true", help="Only compare --gold with --compare")
    parser.add_argument("--scheme", choices=sorted(SCHEMES), default="merged")
    parser.add_argument("--model", choices=("balanced_logistic", "cue_logistic", "stacked_lightgbm"),
                        default="stacked_lightgbm",
                        help="Frozen choice: stacked_lightgbm (selected on development data, see log ML2.11)")
    parser.add_argument("--train-rows", type=Path, default=Path("ml/out/arxiv_expansion/train_blocks.jsonl"))
    parser.add_argument("--context-blocks", type=Path, default=Path("ml/out/arxiv_expansion/context_blocks.jsonl"))
    parser.add_argument("--unweighted", action="store_true", help="Disable source weights (not the selected setting)")
    parser.add_argument("--test-blocks", type=Path, nargs="+",
                        default=[Path("ml/out/full/blocks_sample.jsonl"), Path("ml/out/levin/blocks_sample.jsonl")])
    parser.add_argument("--out", type=Path)
    parser.add_argument("--frozen-test-milestone", action="store_true",
                        help="Required: confirms the model is frozen and this is a milestone read of the test set")
    args = parser.parse_args()

    sample = read_jsonl(args.sample)
    ids = {row["block_id"] for row in sample}
    gold = load_labels(read_jsonl(args.gold), ids)
    agreement = None
    if args.compare:
        other = load_labels(read_jsonl(args.compare), ids)
        shared = sorted(set(gold) & set(other))
        mapping = SCHEMES[args.scheme][0]
        agreement = {"blocks": len(shared),
                     "kappa_seven_class": cohen_kappa([gold[i] for i in shared], [other[i] for i in shared]),
                     f"kappa_{args.scheme}": cohen_kappa([mapping(gold[i]) for i in shared],
                                                        [mapping(other[i]) for i in shared]),
                     "raw_agreement": sum(gold[i] == other[i] for i in shared) / len(shared) if shared else None}
        print(json.dumps({"agreement": agreement}, indent=2))
    if args.kappa_only:
        return
    if not args.frozen_test_milestone:
        parser.error("Refusing to read classifier results on the frozen test set without --frozen-test-milestone")

    blocks = [block for path in args.test_blocks for block in read_jsonl(path)]
    blocks_by_id = {block["block_id"]: block for block in blocks}
    rows = build_rows(sample, gold, blocks_by_id, args.scheme)
    mapping = SCHEMES[args.scheme][0]
    train_rows = [{**row, "label": mapping(row["label"])} for row in read_jsonl(args.train_rows)]
    context_blocks = read_jsonl(args.context_blocks) if args.model != "balanced_logistic" else None
    test_groups = set(json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))["test_groups"])
    if any(row["group"] in test_groups for row in train_rows):
        raise ValueError("Training rows contain a frozen test group")
    predict(rows, train_rows, args.model, context_blocks, blocks, source_weighted=not args.unweighted)
    report = {"gold_file": str(args.gold), "model": args.model, "train_rows": len(train_rows),
              "train_groups": len({row["group"] for row in train_rows}), "source_weighted": not args.unweighted,
              "agreement": agreement, **evaluate(rows, args.scheme)}
    out = args.out or Path(f"ml/results/gold_{args.scheme}_{args.model}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    pd = report["prose_definitions"]
    print(f"heading rule: coverage {report['heading_rule']['coverage']:.3f}, "
          f"accuracy when it fires {report['heading_rule']['accuracy_when_it_fires']}")
    for system in ("classifier", "two_stage"):
        print(f"{system}: accuracy {report[system]['accuracy']:.3f}, macro F1 {report[system]['macro_f1']:.3f}")
    print(f"prose definitions: {pd['count']} in {pd['files']} files, recall {pd['recall']}, "
          f"CI {pd['recall_ci95']['ci95']}, precision on unheaded {pd['precision_on_unheaded']}")
    print(f"Written to {out}")


if __name__ == "__main__":
    main()
