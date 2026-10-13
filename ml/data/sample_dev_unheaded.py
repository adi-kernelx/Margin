"""ML2.14: sample unheaded TRAINING blocks for a development label set.

Every training row so far had a formatted heading, so development scores said
nothing about ordinary prose (ML2.13 finding). This draws unheaded blocks from
training sources only, never from frozen test or excluded groups, for labelling
with the same seven-class guide as the test sample.

Four equal cells: {original sources, arXiv expansion} x {prose-definition
candidate, other unheaded}. Within a cell, sources are cycled so no single PDF
dominates. Like the test sample this is enriched, not population-representative.
"""

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

from ml.data.heading_rules import is_toc_entry
from ml.data.sample_for_labelling import PROSE


def eligible(block, folds):
    if block.get("weak_label") or block["group"] not in folds:
        return False
    text = block["text"].strip()
    if len(text) < 30 or {"furniture", "toc", "toc_page"} & {str(f).lower() for f in block.get("flags", [])}:
        return False
    return not any(is_toc_entry(line) for line in block.get("lines", text.splitlines()))


def sample(blocks, folds, test_groups, size=240, seed=20261013):
    if size % 4:
        raise ValueError("Size must be a multiple of four")
    if set(folds) & set(test_groups):
        raise ValueError("Development sources overlap the frozen test groups")
    cells = defaultdict(lambda: defaultdict(list))
    for block in sorted(blocks, key=lambda b: b["block_id"]):
        if not eligible(block, folds):
            continue
        origin = "arxiv" if block["group"].startswith("arxiv-2") else "original"
        kind = "prose" if PROSE.search(block["text"]) else "other"
        cells[(origin, kind)][block["group"]].append(block)
    rng = random.Random(seed)
    chosen = []
    for key in sorted(cells):
        queues = cells[key]
        for group in sorted(queues):
            rng.shuffle(queues[group])
        groups, picked = sorted(queues), []
        while len(picked) < size // 4 and any(queues.values()):
            for group in groups:
                if queues[group] and len(picked) < size // 4:
                    picked.append(queues[group].pop())
        if len(picked) < size // 4:
            raise ValueError(f"Not enough eligible blocks in cell {key}")
        chosen.extend((key, block) for block in picked)
    rng.shuffle(chosen)
    rows = [{"block_id": b["block_id"], "file": b["file"], "page": b["page"], "text": b["text"]} for _, b in chosen]
    meta = [{"block_id": b["block_id"], "group": b["group"], "fold": folds[b["group"]],
             "origin": key[0], "stratum": key[1]} for key, b in chosen]
    return rows, meta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blocks", type=Path, default=Path("ml/out/arxiv_expansion/context_blocks.jsonl"))
    parser.add_argument("--rows", type=Path, default=Path("ml/out/arxiv_expansion/train_blocks.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("ml/labels/dev_to_label.jsonl"))
    parser.add_argument("--meta", type=Path, default=Path("ml/out/ml214/dev_sample_meta.jsonl"))
    args = parser.parse_args()
    read = lambda path: [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    folds = {row["group"]: row["fold"] for row in read(args.rows)}
    test_groups = json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))["test_groups"]
    rows, meta = sample(read(args.blocks), folds, test_groups)
    args.meta.parent.mkdir(parents=True, exist_ok=True)
    for path, values in ((args.out, rows), (args.meta, meta)):
        with path.open("x", encoding="utf-8") as output:
            output.writelines(json.dumps(value, ensure_ascii=False) + "\n" for value in values)
    print(len(rows), "blocks;", {k: sum(m["origin"] == k[0] and m["stratum"] == k[1] for m in meta)
                                for k in [("original", "prose"), ("original", "other"), ("arxiv", "prose"), ("arxiv", "other")]},
          len({m["group"] for m in meta}), "sources")


if __name__ == "__main__":
    main()
