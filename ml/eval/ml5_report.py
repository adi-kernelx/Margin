"""Paired document intervals, exact McNemar and the pre-registered switch rule."""

import math
from collections import defaultdict

from ml.eval.metrics import METRICS
from ml.eval.ml5_protocol import BASELINE, PRIMARY, VARIANTS
from ml.eval.stats import document_bootstrap


def mcnemar(first, second):
    if len(first) != len(second):
        raise ValueError("Paired outcomes must have equal lengths")
    if any(value not in (0, 1) for value in [*first, *second]):
        return {"p_two_sided": None, "reason": "Requires binary outcomes, not seed-averaged recall"}
    lost = sum(bool(a) and not bool(b) for a, b in zip(first, second))
    gained = sum(not bool(a) and bool(b) for a, b in zip(first, second))
    n = lost + gained
    p = min(1.0, 2 * sum(math.comb(n, k) for k in range(min(lost, gained) + 1)) / 2**n) if n else 1.0
    return {"lost": lost, "gained": gained, "discordant": n, "p_two_sided": p,
            "caveat": "Supporting only: questions within a document are dependent"}


def summarise(rows, baseline=BASELINE):
    if not rows:
        return {"questions": 0, "documents": 0, "metrics": {}, "paired": {}}
    output = {"questions": len(rows), "documents": len({row["file"] for row in rows}), "metrics": {}, "paired": {}}
    for name in VARIANTS:
        output["metrics"][name], output["paired"][name] = {}, {}
        for metric in METRICS:
            absolute, paired = defaultdict(list), defaultdict(list)
            for row in rows:
                absolute[row["file"]].append(row[name][metric])
                paired[row["file"]].append(row[name][metric] - row[baseline][metric])
            output["metrics"][name][metric] = document_bootstrap(absolute)
            output["paired"][name][metric] = document_bootstrap(paired)
        output["paired"][name]["mcnemar_recall_at_5"] = mcnemar(
            [row[baseline]["recall_at_5"] for row in rows], [row[name]["recall_at_5"] for row in rows])
    return output


def report(rows, counts):
    output = {"counts": counts, "sets": {name: summarise([r for r in rows if r["set"] == name])
                                         for name in counts}, "pooled": summarise(rows)}
    output["breakdowns"] = {name: summarise([r for r in rows if
        (r["type"] in {"definition", "needs-definition"}) == definition])
        for name, definition in (("definition_dependent", True), ("other", False))}
    output["by_type"] = {kind: summarise([r for r in rows if r["type"] == kind])
                         for kind in sorted({r["type"] for r in rows})}
    return output


def decision(output):
    if set(output["sets"]) != {"original", "independent"}:
        return {"switch_default": False, "reason": "Requires both frozen test sets"}
    if any(not table["questions"] for table in output["sets"].values()):
        return {"switch_default": False, "reason": "No answerable questions in a test set"}
    paired = output["pooled"]["paired"][PRIMARY]
    checks = {"positive_pooled_mrr_lower": paired["mrr_at_10"]["ci95"][0] > 0,
              "recall_lower_at_least_minus_0_02": paired["recall_at_5"]["ci95"][0] >= -0.02,
              "each_set_mrr_ndcg_nonnegative": all(table["paired"][PRIMARY][metric]["value"] >= 0
                for table in output["sets"].values() for metric in ("mrr_at_10", "ndcg_at_10"))}
    return {"switch_default": all(checks.values()), "checks": checks, "action": "Recommendation only; no service setting changed"}
