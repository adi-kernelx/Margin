"""ML2.14: give the classifier a training signal for unheaded prose.

ML2.13 found that every training row had a heading, so ordinary discussion and
prose definitions were forced into headed roles. Three fixed variants of the
frozen stacked LightGBM are compared, all with source weights:

  A headed_only        - today's training rows (reference);
  B unlabelled_other   - plus a per-source sample of unheaded blocks labelled
                         "other": naive positive-unlabelled (PU) learning, which
                         treats the unlabelled set as negatives and accepts that a
                         few real definitions become noisy negatives;
  C reliable_negatives - as B, but unheaded blocks matching the prose-definition
                         cue regex are left out, since they are the unlabelled
                         blocks most likely to be positives (two-step PU idea:
                         train only on "reliable negatives").

Scoring is out-of-fold by source group, on two sets:
  * the 240 labelled unheaded development blocks (ml/labels/dev_labels.jsonl),
    sampled from training sources only, never from frozen test groups;
  * the headed training rows, to check that the headed path does not regress.

A dev block is predicted only by a model that never saw its source; it is also
removed from every negative pool. Intervals resample source groups.
"""

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

from ml.data.sample_for_labelling import PROSE
from ml.eval.classifier_cv import classification_metrics, source_weights
from ml.eval.label_scheme import MERGED_LABELS, merge_label
from ml.eval.stats import cluster_bootstrap
from ml.models.layout_classifier import FEATURES as LAYOUT

VARIANTS = ("headed_only", "unlabelled_other", "reliable_negatives")
NEGATIVE_RATIO = 1.0      # unheaded negatives per headed row, per source
SEED = 20261013
SCORED = ("definition", "theorem", "proof", "example")


def block_row(block):
    return {"block_id": block["block_id"], "file": block["file"], "group": block["group"],
            "text": block["text"].strip(), "category": block["category"],
            "features": {name: block[name] for name in LAYOUT}}


def negative_pool(blocks, folds, exclude, variant):
    """Unheaded training blocks per group that a variant may use as 'other'."""
    pool = defaultdict(list)
    if variant == "headed_only":
        return pool
    for block in sorted(blocks, key=lambda b: b["block_id"]):
        if block.get("weak_label") or block["group"] not in folds or block["block_id"] in exclude:
            continue
        text = block["text"].strip()
        if len(text) < 30:
            continue
        if variant == "reliable_negatives" and PROSE.search(text):
            continue
        pool[block["group"]].append(block)
    return pool


def sample_negatives(pool, headed_counts, groups, ratio=NEGATIVE_RATIO, seed=SEED):
    rng = random.Random(seed)
    chosen = []
    for group in sorted(groups):
        candidates = list(pool.get(group, []))
        rng.shuffle(candidates)
        chosen.extend(candidates[:max(1, round(ratio * headed_counts.get(group, 0)))])
    return chosen


def run(rows, blocks, dev, fit, attach, variants=VARIANTS, folds_n=5):
    """Return out-of-fold predictions for dev blocks and headed rows, per variant."""
    folds = {row["group"]: row["fold"] for row in rows}
    by_id = {block["block_id"]: block for block in blocks}
    dev_ids = {item["block_id"] for item in dev}
    dev_rows = attach([{**block_row(by_id[item["block_id"]]), "gold": merge_label(item["label"]),
                        "fold": folds[by_id[item["block_id"]]["group"]]} for item in dev])
    headed = attach([{**row, "label": merge_label(row["label"])} for row in rows])
    out = {variant: {"dev": [], "headed": [], "negatives": 0} for variant in variants}
    for variant in variants:
        pool = negative_pool(blocks, folds, dev_ids, variant)
        for fold in range(folds_n):
            train = [row for row in headed if row["fold"] != fold]
            counts = defaultdict(int)
            for row in train:
                counts[row["group"]] += 1
            negatives = attach([{**block_row(b), "label": "other"}
                                for b in sample_negatives(pool, counts, set(counts))]) if pool else []
            data = train + negatives
            model = fit(data, [row["label"] for row in data], sample_weight=source_weights(data))
            out[variant]["negatives"] += len(negatives)
            held_dev = [row for row in dev_rows if row["fold"] == fold]
            held_headed = [row for row in headed if row["fold"] == fold]
            for target, held in (("dev", held_dev), ("headed", held_headed)):
                if not held:
                    continue
                probabilities = model.predict_proba(held)
                for row, scores in zip(held, probabilities):
                    best = max(range(len(model.classes)), key=lambda i: scores[i])
                    out[variant][target].append({
                        "block_id": row["block_id"], "group": row["group"],
                        "gold": row.get("gold", row.get("label")), "pred": model.classes[best],
                        "p_definition": float(scores[model.classes.index("definition")])
                        if "definition" in model.classes else 0.0})
    return out


def _definition_scores(rows, threshold=None):
    def predicted(row):
        return row["p_definition"] >= threshold if threshold is not None else row["pred"] == "definition"
    tp = sum(predicted(r) and r["gold"] == "definition" for r in rows)
    guessed = sum(predicted(r) for r in rows)
    positives = sum(r["gold"] == "definition" for r in rows)
    return (tp / guessed if guessed else None, tp / positives if positives else None)


def summarise(out, resamples=2000):
    report = {}
    for variant, sets in out.items():
        dev, headed = sets["dev"], sets["headed"]
        precision, recall = _definition_scores(dev)
        dev_metrics = classification_metrics([r["gold"] for r in dev], [r["pred"] for r in dev], MERGED_LABELS,
                                             tuple(c for c in SCORED if any(r["gold"] == c for r in dev)) or SCORED)
        head_metrics = classification_metrics([r["gold"] for r in headed], [r["pred"] for r in headed],
                                              MERGED_LABELS, SCORED + ("algorithm",))
        curve = []
        for threshold in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
            p, r = _definition_scores(dev, threshold)
            curve.append({"threshold": threshold, "precision": p, "recall": r})
        report[variant] = {
            "negatives_used_across_folds": sets["negatives"],
            "dev_unheaded": {
                "blocks": len(dev), "accuracy": dev_metrics["accuracy"],
                "accuracy_ci95": cluster_bootstrap(dev, lambda s: sum(r["gold"] == r["pred"] for r in s) / len(s),
                                                   key="group", resamples=resamples)["ci95"],
                "definition_precision": precision, "definition_recall": recall,
                "definition_recall_ci95": cluster_bootstrap(dev, lambda s: _definition_scores(s)[1],
                                                            key="group", resamples=resamples)["ci95"],
                "definition_precision_ci95": cluster_bootstrap(dev, lambda s: _definition_scores(s)[0],
                                                               key="group", resamples=resamples)["ci95"],
                "other_recall": dev_metrics["per_class"]["other"]["recall"],
                "other_precision": dev_metrics["per_class"]["other"]["precision"],
                "per_class": dev_metrics["per_class"], "confusion_matrix": dev_metrics["confusion_matrix"],
                "definition_threshold_curve": curve},
            "headed": {"rows": len(headed), "accuracy": head_metrics["accuracy"], "macro_f1": head_metrics["macro_f1"],
                       "accuracy_ci95": cluster_bootstrap(headed, lambda s: sum(r["gold"] == r["pred"] for r in s) / len(s),
                                                          key="group", resamples=resamples)["ci95"]}}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rows", type=Path, default=Path("ml/out/arxiv_expansion/train_blocks.jsonl"))
    parser.add_argument("--blocks", type=Path, default=Path("ml/out/arxiv_expansion/context_blocks.jsonl"))
    parser.add_argument("--dev", type=Path, default=Path("ml/labels/dev_labels.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("ml/results/unheaded_cv.json"))
    parser.add_argument("--audit", type=Path, default=Path("ml/out/ml214/unheaded_predictions.json"))
    args = parser.parse_args()
    read = lambda path: [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows, blocks, dev = read(args.rows), read(args.blocks), read(args.dev)
    test_groups = set(json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))["test_groups"])
    if {block["group"] for block in blocks} & test_groups:
        raise ValueError("Context blocks include a frozen test group")
    from ml.models.definition_features import attach_context, fit_stacked_lightgbm
    out = run(rows, blocks, dev, fit_stacked_lightgbm, lambda items: attach_context(items, blocks))
    args.audit.parent.mkdir(parents=True, exist_ok=True)
    args.audit.write_text(json.dumps(out) + "\n", encoding="utf-8")
    report = {"test_evaluated": False, "development_blocks": len(dev), "headed_rows": len(rows),
              "negative_ratio": NEGATIVE_RATIO, "seed": SEED, "model": "stacked_lightgbm, source-weighted",
              "variants": summarise(out)}
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for variant, values in report["variants"].items():
        d, h = values["dev_unheaded"], values["headed"]
        print(f"{variant:19} dev acc {d['accuracy']:.3f}  def P {d['definition_precision']}  R {d['definition_recall']:.3f} "
              f"{d['definition_recall_ci95']}  other R {d['other_recall']:.2f} | headed acc {h['accuracy']:.3f}")


if __name__ == "__main__":
    main()
