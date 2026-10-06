"""Aggregate-only repair diagnostics; no source texts or identities in results."""
import json
import re
from collections import Counter
from pathlib import Path

from ml.data.repair_training import original_folds
from ml.eval.error_audit import read_jsonl


def quality_summary(before, after, old_report, new_report, split):
    if original_folds(old_report, split) != original_folds(new_report, split):
        raise ValueError("Repair changed source-fold memberships")
    mapping = original_folds(old_report, split)
    for rows in (before, after):
        if len({r["block_id"] for r in rows}) != len(rows):
            raise ValueError("Duplicate training block identity")
        if any(r["group"] not in mapping or r["fold"] != mapping[r["group"]] for r in rows):
            raise ValueError("Non-training source or changed row fold")
    def counts(rows):
        return {"rows": len(rows), "documents": len({r["file"] for r in rows}),
                "labels": dict(sorted(Counter(r["label"] for r in rows).items())),
                "unfinished_intro_rows": sum(bool(re.search(
                    r"\b(?:given by|yields|expressed as|linear map|compute)\s*[:.]?$", r["text"], re.I)) for r in rows)}
    signature = lambda r: (r["file"], r["page"], r["text"], r["label"])
    overlap = sum((Counter(signature(r) for r in before) & Counter(signature(r) for r in after)).values())
    return {"before": counts(before), "after": counts(after), "exact_content_overlap": overlap,
            "source_folds_preserved": True, "test_evaluated": False,
            "warning": "Intro-ending counts are a diagnostic heuristic, not completeness or gold-label acceptance. Changed rows invalidate direct accuracy-gain claims."}


def main():
    split = json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))
    before = read_jsonl("ml/out/ml2/train_blocks.jsonl")
    after = read_jsonl("ml/out/ml27/verified/train_blocks.jsonl")
    reports = [json.loads(Path(path).read_text(encoding="utf-8")) for path in
               ("ml/out/ml2/training_report.json", "ml/out/ml27/verified/training_report.json")]
    report = quality_summary(before, after, *reports, split)
    Path("ml/results/training_repair_summary.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
