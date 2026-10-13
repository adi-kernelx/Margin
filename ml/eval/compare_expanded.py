"""Paired source-bootstrap comparison on identical expanded development rows.

No model fitting and no frozen-test access. Aggregate rows per source before
resampling, so multiple PDF files from one source stay together. The old/new
plain-logistic predictions must agree exactly before other models are compared.
"""
import json
from collections import defaultdict
from pathlib import Path

from ml.eval.label_scheme import MERGE
from ml.eval.stats import cluster_bootstrap

ROOT = Path("ml/out/arxiv_expansion")


def paired_differences(rows, reference, candidates, resamples=2000):
    by_id = {row["block_id"]: row for row in rows}
    old = {row["block_id"]: row for row in reference}
    new = {row["block_id"]: row for row in candidates}
    if not rows or any(len(values) != len(items) for values, items in
                       ((by_id, rows), (old, reference), (new, candidates))):
        raise ValueError("Need nonempty rows and unique prediction IDs")
    if set(by_id) != set(old) or set(old) != set(new):
        raise ValueError("Comparisons require identical development row IDs")
    for identity, row in by_id.items():
        a, b = old[identity], new[identity]
        if any(pred["file"] != row["file"] or pred["fold"] != row["fold"]
               or pred["gold"] != MERGE.get(row["label"], row["label"]) for pred in (a, b)):
            raise ValueError("Development source, fold or label changed")
        if a["logistic"] != b["logistic"]:
            raise ValueError("Repeated plain-logistic predictions changed")
    methods = ("balanced_logistic", "word_char_logistic", "cue_logistic", "stacked_lightgbm")
    result = {}
    for method in methods:
        aggregates = defaultdict(lambda: {"rows": 0, "accuracy_delta": 0,
                                         "definition_rows": 0, "definition_hit_delta": 0})
        for identity, row in by_id.items():
            prediction = new[identity]
            gold = prediction["gold"]
            values = aggregates[row["group"]]
            values["rows"] += 1
            values["accuracy_delta"] += int(prediction[method] == gold) - int(prediction["logistic"] == gold)
            if gold == "definition":
                values["definition_rows"] += 1
                values["definition_hit_delta"] += int(prediction[method] == gold) - int(prediction["logistic"] == gold)
        groups = [{"group": group, **values} for group, values in sorted(aggregates.items())]
        metrics = {}
        for name, numerator, denominator in (("accuracy", "accuracy_delta", "rows"),
                                              ("definition_recall", "definition_hit_delta", "definition_rows")):
            def statistic(sample, num=numerator, den=denominator):
                count = sum(item[den] for item in sample)
                return sum(item[num] for item in sample) / count if count else None
            metrics[name] = {"delta": statistic(groups), **cluster_bootstrap(
                groups, statistic, key="group", resamples=resamples)}
        result[method] = metrics
    return result


def main():
    def read(name):
        return [json.loads(line) for line in (ROOT / name).read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = read("train_blocks.jsonl")
    report = {"test_evaluated": False, "weak_label_development": True,
              "baseline": "plain source-weighted logistic", "bootstrap_unit": "source group",
              "rows": len(rows), "groups": len({row["group"] for row in rows}),
              "bootstrap_resamples": 2000, "seed": 20261006,
              "paired_differences": paired_differences(rows, read("cv_predictions.jsonl"), read("cv_features_predictions.jsonl")),
              "limitation": "Same-row development comparison, not independent gold; candidates already informed by prior development errors. Scores are row-pooled; sources are the bootstrap unit."}
    Path("ml/results/expanded_paired_comparison.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
