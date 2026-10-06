"""Make 300 independent hand-labelling inputs from the frozen test sources.

Weak labels guide sampling only: they never appear in the exported input.
Three equal target strata: weak-labelled, prose-definition candidates, and
remaining unlabelled. This enriched sample is not population-representative.
Within strata, cycle source groups (and weak classes) to limit dominant PDFs.
"""

import argparse
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

from ml.data.heading_rules import is_toc_entry
from ml.data.make_splits import LABELS, load_inputs


PROSE = re.compile(r"\b(?:we say|is called|is said to be|denot\w*|defin\w*)\b", re.I)


def sample_blocks(blocks, split, seed=20261006, size=300):
    if split.get("status") != "frozen":
        raise ValueError("Hand labelling requires a frozen split")
    if size <= 0 or size % 3:
        raise ValueError("Sample size must be a positive multiple of three")
    test_groups = set(split["test_groups"])
    test = sorted((b for b in blocks if b["group"] in test_groups), key=lambda b: b["block_id"])
    if len({b["block_id"] for b in test}) != len(test):
        raise ValueError("Duplicate block ID")
    page_toc = Counter()
    for block in test:
        for line in block.get("lines", block["text"].splitlines()):
            if is_toc_entry(line):
                page_toc[(block["file"], block["page"])] += 1
    pools = {name: [] for name in ("weak", "prose", "unlabelled")}
    for block in test:
        flags = {str(flag).lower() for flag in block.get("flags", [])}
        if (len(block["text"].strip()) < 30 or flags & {"toc", "toc_page", "furniture"}
                or page_toc[(block["file"], block["page"])] >= 5
                or any(is_toc_entry(line) for line in block["text"].splitlines())):
            continue
        label = block.get("weak_label")
        if label is not None and label not in LABELS:
            raise ValueError("Unknown weak label")
        name = "weak" if label else "prose" if PROSE.search(block["text"]) else "unlabelled"
        pools[name].append(block)
    if sum(map(len, pools.values())) < size:
        raise ValueError("Not enough eligible test blocks")
    rng = random.Random(seed)

    def balanced_order(pool, weak=False):
        queues = defaultdict(list)
        for block in pool:
            key = (block.get("weak_label") if weak else "", block["group"])
            queues[key].append(block)
        keys = sorted(queues)
        for key in keys:
            rng.shuffle(queues[key])
        ordered = []
        while any(queues.values()):
            for key in keys:
                if queues[key]:
                    ordered.append(queues[key].pop())
        return ordered

    orders = {name: balanced_order(pool, name == "weak") for name, pool in pools.items()}
    selected, strata = [], Counter()
    for name, order in orders.items():
        chosen = order[:size // 3]
        selected.extend(chosen)
        strata[name] += len(chosen)
    # Rare strata can be exhausted; fill the remaining places without replacement.
    chosen_ids = {b["block_id"] for b in selected}
    leftovers = [(name, b) for name, order in orders.items() for b in order if b["block_id"] not in chosen_ids]
    rng.shuffle(leftovers)
    for name, block in leftovers[:size - len(selected)]:
        selected.append(block)
        strata[name] += 1
    rng.shuffle(selected)
    rows = [{key: b[key] for key in ("block_id", "file", "page", "text")} for b in selected]
    report = {"seed": seed, "size": size, "strata": dict(strata),
              "eligible": {name: len(pool) for name, pool in pools.items()},
              "groups": dict(sorted(Counter(b["group"] for b in selected).items())),
              "weak_classes": dict(sorted(Counter(b["weak_label"] for b in selected if b.get("weak_label")).items())),
              "note": "Enriched diagnostic sample; do not treat metrics as population estimates."}
    return rows, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", type=Path, default=Path("ml/splits.json"))
    parser.add_argument("--manifest", type=Path, default=Path("Test PDFs/manifest.csv"))
    parser.add_argument("--blocks", type=Path, nargs="+", default=[Path("ml/out/full/blocks_sample.jsonl"), Path("ml/out/levin/blocks_sample.jsonl")])
    parser.add_argument("--out", type=Path, default=Path("ml/labels/to_label.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("ml/out/labelling_sample_report.json"))
    parser.add_argument("--seed", type=int, default=20261006)
    args = parser.parse_args()
    split = json.loads(args.split.read_text(encoding="utf-8"))
    _, blocks = load_inputs(args.manifest, args.blocks)
    rows, report = sample_blocks(blocks, split, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf-8", newline="\n") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("w", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
