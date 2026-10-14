"""ML3: build and check an OKF bundle for every main PDF in the manifest.

Bundles go to the git-ignored ml/out/bundles/<file stem>/ (they quote PDF text).
A numbers-only summary is written to ml/results/okf_bundles_summary.json.

    python -m ml.okf.build_all
"""

import csv
import json
import re
import time
from pathlib import Path

from ml.okf.bundle import write_bundle
from ml.okf.conformance import check
from ml.okf.pipeline import FrozenPipeline


def main():
    pipeline = FrozenPipeline.load()
    with Path("Test PDFs/manifest.csv").open(encoding="utf-8", newline="") as source:
        rows = [r for r in csv.DictReader(source) if r["use"] == "main"]
    summary = {"pdfs": len(rows), "bundles": [], "conformant": 0}
    for index, row in enumerate(rows, 1):
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(row["file"]).stem)[:80]
        out = Path("ml/out/bundles") / stem
        started = time.time()
        result = write_bundle(Path("Test PDFs") / row["file"], out, pipeline, category=row["category"])
        report = check(out)
        summary["conformant"] += report["conformant"]
        summary["bundles"].append({"group": row["group"], "category": row["category"], **result,
                                   "conformant": report["conformant"], "errors": len(report["errors"]),
                                   "warnings": len(report["warnings"]), "seconds": round(time.time() - started, 1)})
        print(f"{index}/{len(rows)} {row['category']:10} concepts {result['concepts']:4} links {result['links']:4} "
              f"conformant {report['conformant']}", flush=True)
    totals = {}
    for bundle in summary["bundles"]:
        for kind, count in bundle["types"].items():
            totals[kind] = totals.get(kind, 0) + count
    summary["concept_types"] = totals
    summary["concepts"] = sum(b["concepts"] for b in summary["bundles"])
    summary["links"] = sum(b["links"] for b in summary["bundles"])
    Path("ml/results/okf_bundles_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print({key: summary[key] for key in ("pdfs", "conformant", "concepts", "links", "concept_types")})


if __name__ == "__main__":
    main()
