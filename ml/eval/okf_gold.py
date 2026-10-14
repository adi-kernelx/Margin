"""ML3.2: score hand-labelled OKF concepts and links (see ml/eval/okf_sample.py).

Reports, with 95% intervals that resample whole documents:
  concept precision   share of concepts that really state what their type says
  title good rate     share of real concepts whose title is `good`
  title usable rate   share of real concepts whose title is good or partial
  link precision      share of links whose source really refers to the target
Each broken down by method (heading / detector) where it applies. Numbers only;
the labelled file stays git-ignored because it quotes the PDFs.

    python -m ml.eval.okf_gold --labels ml/labels/okf_dev.jsonl --out ml/results/okf_gold_dev.json
"""

import argparse
import json
from pathlib import Path

from ml.eval.stats import cluster_bootstrap


def rate(rows, test):
    return sum(test(r) for r in rows) / len(rows) if rows else None


def measure(rows, test):
    value = rate(rows, test)
    result = {"n": len(rows), "value": None if value is None else round(value, 3)}
    if rows:
        interval = cluster_bootstrap(rows, lambda sample: rate(sample, test), key="doc")
        result["ci95"] = [round(x, 3) for x in interval["ci95"]] if interval["ci95"] else None
    return result


def score(items):
    """Items marked `dropped` (by ml/eval/okf_carry.py) are no longer produced: they
    leave the precision and title rates, and are counted separately."""
    report = {"documents": len({i["doc"] for i in items})}
    dropped = [i for i in items if i.get("dropped")]
    if dropped:
        report["dropped"] = {
            "concepts_real": sum(i["kind"] == "concept" and i["real"] == "yes" for i in dropped),
            "concepts_not_real": sum(i["kind"] == "concept" and i["real"] == "no" for i in dropped),
            "links_ok": sum(i["kind"] == "link" and i["link_ok"] == "yes" for i in dropped),
            "links_wrong": sum(i["kind"] == "link" and i["link_ok"] == "no" for i in dropped)}
    items = [i for i in items if not i.get("dropped")]
    concepts = [i for i in items if i["kind"] == "concept"]
    links = [i for i in items if i["kind"] == "link"]
    missing = [i for i in concepts if i["real"] is None or i["title_label"] is None] + \
              [i for i in links if i["link_ok"] is None]
    if missing:
        raise ValueError(f"{len(missing)} items are unlabelled")
    for name, subset in [("all", concepts)] + [(m, [c for c in concepts if c["method"] == m])
                                               for m in ("heading", "detector")]:
        real = [c for c in subset if c["real"] == "yes"]
        report[f"concepts_{name}"] = {
            "precision": measure(subset, lambda c: c["real"] == "yes"),
            "title_good": measure(real, lambda c: c["title_label"] == "good"),
            "title_usable": measure(real, lambda c: c["title_label"] in ("good", "partial")),
        }
    fallback = [c for c in concepts if c["title"].startswith("Notation (page")]
    report["fallback_titles"] = {"n": len(fallback), "share": round(len(fallback) / len(concepts), 3),
                                 "real": sum(c["real"] == "yes" for c in fallback)}
    report["links"] = measure(links, lambda l: l["link_ok"] == "yes")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    items = [json.loads(line) for line in args.labels.read_text(encoding="utf-8").splitlines()]
    report = score(items)
    print(json.dumps(report, indent=2))
    if args.out:
        args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
