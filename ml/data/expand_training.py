"""Assemble an uncapped train-only extension without changing frozen files."""
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from ml.data.arxiv_corpus import ROOT
from ml.data.prepare_training import prepare


def extend_split(frozen, papers):
    extension = json.loads(json.dumps(frozen))
    groups = ["arxiv-" + paper["base_id"] for paper in papers]
    if len(groups) != len(set(groups)) or set(groups) & set(
            frozen["train_groups"] + frozen["test_groups"] + frozen["excluded_groups"]):
        raise ValueError("New source identities must be unique and disjoint from frozen groups")
    extension["train_groups"] += groups
    extension["extension"] = "User-authorized arXiv training-only expansion; original test/excluded unchanged"
    return extension


def training_context(blocks, split):
    """Keep unlabelled neighbours, but exclude every non-training group."""
    train = set(split["train_groups"])
    return [block for block in blocks if block["group"] in train]


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-blocks", type=Path, default=Path("ml/out/ml27/verified/blocks.jsonl"),
                        help="Extracted blocks of the original frozen training PDFs")
    args = parser.parse_args()
    frozen_path = Path("ml/splits.json")
    frozen_bytes = frozen_path.read_bytes()
    frozen = json.loads(frozen_bytes)
    papers = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    extension = extend_split(frozen, papers)
    paths = [args.base_blocks] + [ROOT / (p["id"] + ".blocks.jsonl") for p in papers]
    # All requested sources must finish extraction; no silent partial population.
    blocks = [json.loads(line) for path in paths for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows, report = prepare(blocks, extension)
    coverage = defaultdict(set)
    for row in rows:
        coverage[row["label"]].add(row["group"])
    report.update(new_papers=len(papers), source_coverage={key: len(value) for key, value in coverage.items()},
                  original_split_sha256=hashlib.sha256(frozen_bytes).hexdigest(),
                  test_evaluated=False, sample_weight="1 / usable rows from that source",
                  new_weak_labels=sum(b.get("weak_label") is not None for b in blocks if b["group"].startswith("arxiv-") and b["group"] not in frozen["train_groups"]),
                  new_usable_rows=sum(row["group"] not in frozen["train_groups"] for row in rows))
    with Path("Test PDFs/manifest.csv").open(encoding="utf-8", newline="") as source:
        manifest = [{key: entry[key] for key in ("file", "group", "category", "use")} for entry in csv.DictReader(source)]
    manifest += [{"file": p["id"] + ".pdf", "group": "arxiv-" + p["base_id"], "category": "paper", "use": "main"} for p in papers]
    if len({entry["file"] for entry in manifest}) != len(manifest):
        raise ValueError("Duplicate manifest filename")
    (ROOT / "training_split.json").write_text(json.dumps(extension, indent=2) + "\n", encoding="utf-8")
    with (ROOT / "training_manifest.csv").open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=["file", "group", "category", "use"])
        writer.writeheader()
        writer.writerows(manifest)
    (ROOT / "train_blocks.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    # Context needs unlabelled neighbours too, but never held-out sources.
    (ROOT / "context_blocks.jsonl").write_text("".join(json.dumps(block, ensure_ascii=False) + "\n" for block in
        training_context(blocks, extension)), encoding="utf-8")
    (ROOT / "training_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    public = {key: report[key] for key in ("blocks", "new_papers", "new_weak_labels", "new_usable_rows", "labels", "source_coverage", "dropped", "original_split_sha256", "test_evaluated", "sample_weight")}
    public.update(training_groups=len(extension["train_groups"]), usable_groups=len({r["group"] for r in rows}),
                  requested_categories={category: sum(p["category"] == category for p in papers) for category in sorted({p["category"] for p in papers})},
                  folds=[{key: fold[key] for key in ("fold", "blocks", "labels", "missing_labels")} for fold in report["folds"]])
    Path("ml/results/arxiv_expansion_summary.json").write_text(json.dumps(public, indent=2) + "\n", encoding="utf-8")
    if frozen_path.read_bytes() != frozen_bytes:
        raise RuntimeError("Frozen split changed during expansion")
    print(json.dumps({key: report[key] for key in ("blocks", "new_papers", "new_weak_labels", "new_usable_rows", "labels", "source_coverage", "dropped")}, indent=2))


if __name__ == "__main__":
    main()
