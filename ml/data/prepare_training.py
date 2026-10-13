"""ML2.1 plumbing: heading-free weak supervision and train-only source folds.

No classifier, feature fitting or test evaluation. Unlabelled is not 'other'.
Sources have equal total sample weight; folds never divide a source.
"""

import argparse
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

from ml.data.make_splits import LABELS, load_inputs


FEATURES = ("bold_ratio", "font_size_rel", "indent_rel", "math_char_ratio", "gap_above_rel")


def prepare(blocks, split, cap=None, folds=5, seed=20261006, source_folds=None):
    if split.get("status") != "frozen":
        raise ValueError("Training preparation requires the frozen split")
    train = set(split["train_groups"])
    if train & (set(split["test_groups"]) | set(split["excluded_groups"])):
        raise ValueError("Training groups overlap held-out/excluded sources")
    if (cap is not None and (type(cap) is not int or cap < 1)) or not 2 <= folds <= len(train):
        raise ValueError("Need positive source cap and 2..train-group-count folds")
    if source_folds is not None and (set(source_folds) != train or any(
            type(value) is not int or value not in range(folds) for value in source_folds.values())):
        raise ValueError("Source folds must cover exactly frozen training groups with valid fold indices")
    candidates, dropped = defaultdict(list), Counter()
    seen = set()
    for block in blocks:
        if block["group"] not in train:
            continue
        if block["block_id"] in seen:
            raise ValueError("Duplicate training block ID")
        seen.add(block["block_id"])
        label = block.get("weak_label")
        if label is None:
            dropped["unlabelled"] += 1
            continue
        if label not in LABELS:
            raise ValueError("Unknown training weak label")
        text = block.get("text_without_heading")
        if not isinstance(text, str):
            raise ValueError("Missing heading-free text; never fall back to full text")
        if len(text.strip()) < 30:
            dropped["short_heading_free"] += 1
            continue
        candidates[block["group"]].append(block)
    rng, selected = random.Random(seed), []
    for group in sorted(train):
        queues = defaultdict(list)
        for block in sorted(candidates[group], key=lambda row: row["block_id"]):
            queues[block["weak_label"]].append(block)
        for label in sorted(queues):
            rng.shuffle(queues[label])
        chosen = []
        limit = len(candidates[group]) if cap is None else cap
        # Class cycling within a source retains sparse labels when capping it.
        while len(chosen) < limit and any(queues.values()):
            for label in sorted(queues):
                if queues[label] and len(chosen) < limit:
                    chosen.append(queues[label].pop())
        dropped["source_cap"] += len(candidates[group]) - len(chosen)
        selected.extend(chosen)
    if not selected:
        raise ValueError("No usable heading-free training blocks")
    counts = Counter(block["group"] for block in selected)
    fold_groups, loads = [[] for _ in range(folds)], [0] * folds
    # Greedy block-count balancing, ties resolved by fold index/group name.
    for group in sorted(train, key=lambda group: (-counts[group], group)):
        index = source_folds[group] if source_folds is not None else min(range(folds), key=lambda i: (loads[i], len(fold_groups[i]), i))
        fold_groups[index].append(group)
        loads[index] += counts[group]
    fold_of = {group: index for index, groups in enumerate(fold_groups) for group in groups}
    rows = []
    for block in sorted(selected, key=lambda row: (row["group"], row["block_id"])):
        rows.append({"block_id": block["block_id"], "file": block["file"], "group": block["group"],
                     "page": block["page"], "text": block["text_without_heading"].strip(),
                     "label": block["weak_label"], "category": block["category"],
                     "features": {key: block[key] for key in FEATURES}, "fold": fold_of[block["group"]],
                     "sample_weight": 1.0 / counts[block["group"]]})
    fold_stats = []
    for index, groups in enumerate(fold_groups):
        labels = Counter(row["label"] for row in rows if row["fold"] == index)
        fold_stats.append({"fold": index, "groups": sorted(groups), "blocks": loads[index],
                           "labels": dict(sorted(labels.items())), "missing_labels": sorted(set(LABELS) - labels.keys())})
    return rows, {"seed": seed, "source_cap": cap, "blocks": len(rows), "dropped": dict(dropped),
                  "labels": dict(sorted(Counter(row["label"] for row in rows).items())),
                  "groups": {group: counts[group] for group in sorted(train)}, "folds": fold_stats,
                  "warning": "Weak labels are not gold; do not use test sources to tune. Missing fold classes limit CV."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blocks", type=Path, nargs="+", default=[Path("ml/out/full/blocks_sample.jsonl"), Path("ml/out/levin/blocks_sample.jsonl")])
    parser.add_argument("--split", type=Path, default=Path("ml/splits.json"))
    parser.add_argument("--out", type=Path, default=Path("ml/out/ml2"))
    args = parser.parse_args()
    _, blocks = load_inputs("Test PDFs/manifest.csv", args.blocks)
    rows, report = prepare(blocks, json.loads(args.split.read_text(encoding="utf-8")))
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "train_blocks.jsonl").open("x", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    with (args.out / "training_report.json").open("w", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
