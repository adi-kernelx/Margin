"""Propose a reproducible source-group split; never overwrite a reviewed split.

Run from the repository root: python -m ml.data.make_splits
The seed fills spare places after the required coverage groups are reserved.
Weak labels are used only for dataset coverage, never model selection.
The proposal remains unfrozen until the user accepts it.
"""

import argparse
import csv
import json
import random
from collections import Counter
from pathlib import Path


SEED = 20261006
KEEP_TRAIN = {"sipser", "upadhyay-ma3204", "atangana-offline-cbdc"}
# Explicit coverage choices are easier to review than an opaque random search.
REQUIRED_TEST = {
    "levin-discrete",                 # independent native-text textbook
    "bayes-sampling",                 # independent slide template
    "arxiv-boussard-identifiability", # maths, includes definitions
    "arxiv-resende-recirc",           # statistics
    "boneh-franklin",                 # older paper, prose definitions
    "nist-fips",                      # all three standards stay together
    "rafiee-cbdc-pki",                # payments/systems
    "design-brief",                   # non-maths negative examples
}
LABELS = ("definition", "theorem", "proof", "example", "notation", "algorithm", "other")


def load_inputs(manifest_path, blocks_path):
    with Path(manifest_path).open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    paths = [blocks_path] if isinstance(blocks_path, (str, Path)) else blocks_path
    blocks = []
    for path in paths:
        with Path(path).open(encoding="utf-8") as source:
            blocks.extend(json.loads(line) for line in source if line.strip())
    return rows, blocks


def make_split(rows, blocks, seed=SEED, test_count=10):
    """Validate the extraction and partition entire sources into train/test.

    Mixed eligible/scan-only groups are rejected: silently assigning part of a
    source would undermine the source isolation this split is meant to enforce.
    Train includes future grouped development folds, not a separate dev split.
    """
    files = {row["file"]: row for row in rows}
    if len(files) != len(rows):
        raise ValueError("Duplicate manifest filename")
    if any(row["use"] not in {"main", "other", "scan-slice"} for row in rows):
        raise ValueError("Unknown manifest use")
    eligible = {row["group"] for row in rows if row["use"] in {"main", "other"}}
    excluded = {row["group"] for row in rows if row["use"] == "scan-slice"}
    if eligible & excluded:
        raise ValueError("Mixed eligible and scan-slice source group")
    if not REQUIRED_TEST <= eligible or not KEEP_TRAIN <= eligible:
        raise ValueError("Required coverage/train groups missing from manifest")
    seen_ids = set()
    seen_files = set()
    for block in blocks:
        row = files.get(block["file"])
        if row is None or row["use"] == "scan-slice":
            raise ValueError("Block from unknown or excluded file")
        if block["group"] != row["group"] or block["category"] != row["category"]:
            raise ValueError("Block group/category disagrees with manifest")
        if block["block_id"] in seen_ids:
            raise ValueError("Duplicate block ID")
        if block.get("weak_label") not in (None, *LABELS):
            raise ValueError("Unknown weak label")
        seen_ids.add(block["block_id"])
        seen_files.add(block["file"])
    expected_files = {row["file"] for row in rows if row["use"] in {"main", "other"}}
    if seen_files != expected_files:
        raise ValueError("Extraction must cover every eligible manifest file")
    candidates = sorted(eligible - REQUIRED_TEST - KEEP_TRAIN)
    if not len(REQUIRED_TEST) <= test_count <= len(eligible - KEEP_TRAIN):
        raise ValueError("Test group count cannot meet coverage/train constraints")
    random.Random(seed).shuffle(candidates)
    test = REQUIRED_TEST | set(candidates[:test_count - len(REQUIRED_TEST)])
    train = eligible - test

    def summarise(groups):
        subset = [block for block in blocks if block["group"] in groups]
        counts = Counter(block["weak_label"] for block in subset if block.get("weak_label"))
        return {
            "groups": len(groups),
            "files": sum(row["group"] in groups for row in rows),
            "blocks": len(subset),
            "weak_labelled": sum(counts.values()),
            "unlabelled": len(subset) - sum(counts.values()),
            "labels": {label: counts[label] for label in LABELS},
            "categories": sorted({row["category"] for row in rows if row["group"] in groups}),
        }

    test_stats = summarise(test)
    if test_stats["weak_labelled"] < 60 or test_stats["labels"]["definition"] == 0:
        raise ValueError("Test needs at least 60 weak labels including definitions")
    warnings = []
    if "textbook" not in test_stats["categories"]:
        raise ValueError("Test must include an eligible textbook")
    return {
        "seed": seed,
        "status": "proposed",
        "test_groups": sorted(test),
        "train_groups": sorted(train),
        "excluded_groups": sorted(excluded),
        "warnings": warnings,
        "stats": {"train": summarise(train), "test": test_stats, "excluded": summarise(excluded)},
        "group_stats": {group: summarise({group}) for group in sorted(eligible | excluded)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("Test PDFs/manifest.csv"))
    parser.add_argument("--blocks", type=Path, nargs="+", default=[
        Path("ml/out/full/blocks_sample.jsonl"), Path("ml/out/levin/blocks_sample.jsonl")])
    parser.add_argument("--out", type=Path, default=Path("ml/splits.json"))
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--test-count", type=int, default=10)
    args = parser.parse_args()
    proposal = make_split(*load_inputs(args.manifest, args.blocks), args.seed, args.test_count)
    # Exclusive creation prevents a routine rerun from changing an accepted set.
    with args.out.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(proposal, output, indent=2, ensure_ascii=False)
        output.write("\n")
    for name, stats in proposal["stats"].items():
        print(f"{name}: {stats['groups']} groups, {stats['files']} files, "
              f"{stats['blocks']} blocks, {stats['weak_labelled']} weak labels")
        print("  labels:", stats["labels"])
    print("Proposed test groups:", ", ".join(proposal["test_groups"]))
    for warning in proposal["warnings"]:
        print("Coverage gap:", warning)
    print("Awaiting user review; test groups are not frozen.")


if __name__ == "__main__":
    main()
