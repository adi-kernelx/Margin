"""Re-extract frozen training sources only, retaining their original CV folds.

Old extraction, training rows and baseline reports are never overwritten.
The regenerated dataset changes weak supervision: its scores are not directly
comparable to old-row scores and are not independent gold evaluation.
"""

import argparse
import csv
import json
from dataclasses import asdict
from pathlib import Path

from ml.data.extract_blocks import process_pdf
from ml.data.prepare_training import prepare
from ml.eval.validate_questions import group_splits


def original_folds(report, split):
    routes = group_splits(split)
    mapping = {}
    for fold in report["folds"]:
        for group in fold["groups"]:
            if group in mapping or routes.get(group) != "train":
                raise ValueError("Duplicate or non-training source in original folds")
            mapping[group] = fold["fold"]
    if set(mapping) != set(split["train_groups"]) or any(type(v) is not int or v not in range(5) for v in mapping.values()):
        raise ValueError("Original folds must cover every frozen training source")
    return mapping


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("ml/out/ml27"))
    args = parser.parse_args()
    for name in ("blocks.jsonl", "train_blocks.jsonl", "training_report.json"):
        if (args.out / name).exists():
            raise FileExistsError("Use a fresh output directory; previous datasets are never overwritten")
    split = json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))
    previous = json.loads(Path("ml/out/ml2/training_report.json").read_text(encoding="utf-8"))
    folds = original_folds(previous, split)
    blocks = []
    with Path("Test PDFs/manifest.csv").open(encoding="utf-8", newline="") as source:
        for item in csv.DictReader(source):
            if item["group"] not in folds:
                continue
            result = process_pdf(str(Path("Test PDFs") / item["file"]), item["file"], item["group"], item["category"])
            blocks.extend(asdict(block) for block in result.blocks)
            print("Processed training document:", len(result.blocks), "blocks")
    rows, report = prepare(blocks, split, cap=200, source_folds=folds)
    report.update(test_evaluated=False, regenerated_training_only=True,
                  previous_rows=previous["blocks"], comparison_warning="Changed weak-label dataset; not an accuracy gain on identical rows.")
    args.out.mkdir(parents=True, exist_ok=True)
    for name, values in (("blocks.jsonl", blocks), ("train_blocks.jsonl", rows)):
        with (args.out / name).open("x", encoding="utf-8") as output:
            for row in values:
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
    (args.out / "training_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("Training rows:", len(rows), "labels:", report["labels"])


if __name__ == "__main__":
    main()
