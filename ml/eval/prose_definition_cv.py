"""ML2.14: evaluate the sentence-level prose-definition detector on the dev set.

Fixed variants (no tuning beyond the cross-fitted threshold):
  D1 full           - LaTeX positives + headed-definition sentences; emphasis on;
  D2 no_latex       - ablation: without the LaTeX-derived positives;
  D3 no_emphasis    - ablation: emphasis features switched off.

For development fold k, every training sentence comes from sources outside
fold k, dev-labelled blocks never enter training, and the threshold for fold k
is chosen on the OTHER folds' dev labels only (maximum F1 on a fixed grid).
The detector decides "definition"; other roles come from ML2.14 variant C
(reliable negatives), whose out-of-fold dev predictions are reused.
"""

import argparse
import json
import random
import re
from collections import defaultdict
from pathlib import Path

from ml.eval.classifier_cv import source_weights
from ml.eval.label_scheme import merge_label
from ml.eval.stats import cluster_bootstrap
from ml.eval.unheaded_cv import negative_pool, sample_negatives
from ml.models.prose_definitions import SENTENCE_CUES, block_sentences, fit_sentence_detector

VARIANTS = {"full": {"latex": True, "emphasis": True},
            "no_latex": {"latex": False, "emphasis": True},
            "no_emphasis": {"latex": True, "emphasis": False}}
GRID = [round(0.05 * i, 2) for i in range(4, 20)]
SEED = 20261013
NEGATIVE_SENTENCES_PER_BLOCK = 4
HEADED_SENTENCES_PER_BLOCK = 2
DEFINITIONS = ("definition", "notation")


def training_sentences(rows, blocks, latex, terms, train_groups, dev_ids, use_latex, use_emphasis, folds):
    """(sentence, features, label, group) for one fold's training sources."""
    by_id = {block["block_id"]: block for block in blocks}
    emphasis = (lambda block_id: terms.get(block_id, [])) if use_emphasis else (lambda block_id: [])
    data = []
    if use_latex:
        for item in latex:
            if item["group"] in train_groups and item["block_id"] not in dev_ids:
                pairs = block_sentences(by_id[item["block_id"]], emphasis(item["block_id"]))
                if item["sentence_index"] < len(pairs):
                    sentence, features = pairs[item["sentence_index"]]
                    data.append((sentence, features, 1, item["group"]))
    rng = random.Random(SEED)
    counts = defaultdict(int)
    for row in rows:
        if row["group"] not in train_groups:
            continue
        counts[row["group"]] += 1
        block = by_id.get(row["block_id"])
        if block is None:
            continue
        pairs = block_sentences(block, emphasis(row["block_id"]))
        if row["label"] in DEFINITIONS:
            cued = [(s, f) for s, f in pairs if f["emphasis"] or any(v for k, v in f.items() if k.startswith("cue_"))]
            for sentence, features in cued[:HEADED_SENTENCES_PER_BLOCK]:
                data.append((sentence, features, 1, row["group"]))
        elif row["label"] in ("theorem", "proof", "example", "algorithm"):
            for sentence, features in pairs[:HEADED_SENTENCES_PER_BLOCK]:
                data.append((sentence, features, 0, row["group"]))
    pool = negative_pool(blocks, folds, dev_ids, "reliable_negatives")
    for block in sample_negatives(pool, counts, train_groups):
        pairs = block_sentences(block, emphasis(block["block_id"]))
        rng.shuffle(pairs)
        for sentence, features in pairs[:NEGATIVE_SENTENCES_PER_BLOCK]:
            data.append((sentence, features, 0, block["group"]))
    return data


def f1(precision, recall):
    return 2 * precision * recall / (precision + recall) if precision and recall else 0.0


def pr_at(items, threshold):
    tp = sum(i["score"] >= threshold and i["positive"] for i in items)
    guessed = sum(i["score"] >= threshold for i in items)
    positives = sum(i["positive"] for i in items)
    return (tp / guessed if guessed else 0.0), (tp / positives if positives else 0.0)


def cross_fitted_thresholds(items, folds_n=5):
    chosen = {}
    for fold in range(folds_n):
        others = [i for i in items if i["fold"] != fold]
        chosen[fold] = max(GRID, key=lambda t: (f1(*pr_at(others, t)), t))
    return chosen


def evaluate(items, c_predictions):
    thresholds = cross_fitted_thresholds(items)
    for item in items:
        item["is_definition"] = item["score"] >= thresholds[item["fold"]]
        c_label = c_predictions[item["block_id"]]
        item["final"] = "definition" if item["is_definition"] else ("other" if c_label == "definition" else c_label)
    def precision(s):
        guessed = [i for i in s if i["is_definition"]]
        return sum(i["positive"] for i in guessed) / len(guessed) if guessed else None
    def recall(s):
        positives = [i for i in s if i["positive"]]
        return sum(i["is_definition"] for i in positives) / len(positives) if positives else None
    ranked = sorted(items, key=lambda i: -i["score"])
    hits, average_precision = 0, 0.0
    for rank, item in enumerate(ranked, 1):
        if item["positive"]:
            hits += 1
            average_precision += hits / rank
    positives = sum(i["positive"] for i in items)
    return {"thresholds_by_fold": thresholds,
            "definition_precision": precision(items), "definition_recall": recall(items),
            "definition_f1": f1(precision(items) or 0, recall(items) or 0),
            "precision_ci95": cluster_bootstrap(items, precision, key="group")["ci95"],
            "recall_ci95": cluster_bootstrap(items, recall, key="group")["ci95"],
            "average_precision": average_precision / positives if positives else None,
            "dev_accuracy_with_variant_c": sum(i["final"] == i["gold"] for i in items) / len(items),
            "dev_accuracy_ci95": cluster_bootstrap(items, lambda s: sum(i["final"] == i["gold"] for i in s) / len(s),
                                                   key="group")["ci95"],
            "curve": [{"threshold": t, "precision": pr_at(items, t)[0], "recall": pr_at(items, t)[1]} for t in GRID]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rows", type=Path, default=Path("ml/out/arxiv_expansion/train_blocks.jsonl"))
    parser.add_argument("--blocks", type=Path, default=Path("ml/out/arxiv_expansion/context_blocks.jsonl"))
    parser.add_argument("--dev", type=Path, default=Path("ml/labels/dev_labels.jsonl"))
    parser.add_argument("--latex", type=Path, default=Path("ml/out/ml214/latex_positives.jsonl"))
    parser.add_argument("--emphasis", type=Path, default=Path("ml/out/ml214/emphasis_train.jsonl"))
    parser.add_argument("--variant-c", type=Path, default=Path("ml/out/ml214/unheaded_predictions.json"))
    parser.add_argument("--out", type=Path, default=Path("ml/results/prose_definition_cv.json"))
    args = parser.parse_args()
    read = lambda path: [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows, blocks, dev, latex = read(args.rows), read(args.blocks), read(args.dev), read(args.latex)
    terms = {item["block_id"]: item["emphasis"] for item in read(args.emphasis)}
    c_predictions = {item["block_id"]: item["pred"] for item in
                     json.loads(args.variant_c.read_text(encoding="utf-8"))["reliable_negatives"]["dev"]}
    test_groups = set(json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))["test_groups"])
    if {block["group"] for block in blocks} & test_groups:
        raise ValueError("Training blocks include a frozen test group")
    folds = {row["group"]: row["fold"] for row in rows}
    by_id = {block["block_id"]: block for block in blocks}
    dev_ids = {item["block_id"] for item in dev}
    report = {"test_evaluated": False, "dev_blocks": len(dev), "latex_positive_sentences": len(latex), "variants": {}}
    # Baselines on the same binary target: does the block contain a definition?
    target = {item["block_id"]: item.get("contains_definition", merge_label(item["label"]) == "definition")
              for item in dev}
    variant_runs = json.loads(args.variant_c.read_text(encoding="utf-8"))
    strong = re.compile("|".join(p for k, p in SENTENCE_CUES.items() if k != "gloss"), re.I)
    decisions = {name: {p["block_id"]: p["pred"] == "definition" for p in variant_runs[key]["dev"]}
                 for name, key in (("A_headed_only", "headed_only"), ("C_reliable_negatives", "reliable_negatives"))}
    decisions["strong_cue_rule"] = {key: bool(strong.search(by_id[key]["text"])) for key in target}
    report["baselines_contains_definition"] = {}
    for name, chosen in decisions.items():
        tp = sum(chosen[key] and target[key] for key in target)
        guessed, positives = sum(chosen[key] for key in target), sum(target.values())
        report["baselines_contains_definition"][name] = {"precision": tp / guessed if guessed else None,
                                                         "recall": tp / positives}
    print("baselines:", json.dumps(report["baselines_contains_definition"]))
    for name, options in VARIANTS.items():
        items = []
        for fold in range(5):
            train_groups = {group for group, value in folds.items() if value != fold}
            data = training_sentences(rows, blocks, latex, terms, train_groups, dev_ids,
                                      options["latex"], options["emphasis"], folds)
            weights = source_weights([{"group": group} for *_, group in data])
            detector = fit_sentence_detector([d[0] for d in data], [d[1] for d in data], [d[2] for d in data],
                                             sample_weight=weights)
            for item in dev:
                block = by_id[item["block_id"]]
                if folds[block["group"]] != fold:
                    continue
                score = detector.block_score(block, terms.get(item["block_id"], []) if options["emphasis"] else [])
                items.append({"block_id": item["block_id"], "group": block["group"], "fold": fold,
                              "gold": merge_label(item["label"]),
                              "positive": item.get("contains_definition", merge_label(item["label"]) == "definition"),
                              "score": score})
            if fold == 0:
                report["variants"].setdefault(name, {})["training_sentences_fold0"] = {
                    "positive": sum(d[2] for d in data), "negative": sum(1 - d[2] for d in data)}
                report["variants"][name]["hand_weights_fold0"] = detector.hand_weights()
        report["variants"][name].update(evaluate(items, c_predictions))
        v = report["variants"][name]
        print(f"{name:12} P {v['definition_precision']:.3f} R {v['definition_recall']:.3f} F1 {v['definition_f1']:.3f} "
              f"AP {v['average_precision']:.3f} dev acc {v['dev_accuracy_with_variant_c']:.3f} "
              f"R CI {v['recall_ci95']} thresholds {sorted(set(v['thresholds_by_fold'].values()))}", flush=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
