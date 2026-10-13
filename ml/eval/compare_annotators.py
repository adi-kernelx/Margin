"""Compare two independent annotations of the test sample and adjudicate disagreements.

Annotator A: ml/labels/gold_labels.jsonl (this project's first annotation).
Annotator B: ml/labels/second_annotator/batch_*.jsonl (the second AI).

Step 1 (default): validate B, report agreement and write
ml/labels/second_annotator/disagreements.jsonl with one line per block where the
annotators differ on `label` or `contains_definition`. Each line has
"final_label" and "final_contains" set to null for a decision.

Step 2 (--finalize): after every disagreement has a decision, write
ml/labels/adjudicated_labels.jsonl: agreed blocks keep the shared answer,
disagreements take the recorded decision. That file is the gold set to use.

Agreement is reported as Cohen's kappa on the seven roles, on the merged scheme
(notation -> definition) and on contains_definition, with raw agreement.
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from ml.data.make_splits import LABELS
from ml.eval.gold_eval import cohen_kappa
from ml.eval.label_scheme import merge_label

FOLDER = Path("ml/labels/second_annotator")


def read_jsonl(path):
    rows = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), 1):
        line = line.strip().strip("`")
        if not line or line.lower() in ("json", "jsonl", "continue"):
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise ValueError(f"{path}:{number}: not JSON: {line[:60]}") from error
    return rows


def load_b(sample_ids, folder=FOLDER):
    answers = {}
    for path in sorted(folder.glob("batch_*.jsonl")):
        for row in read_jsonl(path):
            if row.get("block_id") not in sample_ids:
                raise ValueError(f"{path.name}: unknown block_id {row.get('block_id')!r}")
            if row.get("label") not in LABELS or not isinstance(row.get("contains_definition"), bool):
                raise ValueError(f"{path.name}: bad label or contains_definition for {row['block_id']}")
            if row["block_id"] in answers:
                raise ValueError(f"{path.name}: duplicate block_id {row['block_id']}")
            if row["label"] in ("definition", "notation") and not row["contains_definition"]:
                row["contains_definition"] = True   # the guide makes this implication explicit
            answers[row["block_id"]] = row
    return answers


def agreement(a, b, ids):
    first, second = [a[i] for i in ids], [b[i] for i in ids]
    return {
        "blocks": len(ids),
        "kappa_roles": cohen_kappa([x["label"] for x in first], [x["label"] for x in second]),
        "kappa_merged": cohen_kappa([merge_label(x["label"]) for x in first], [merge_label(x["label"]) for x in second]),
        "kappa_contains_definition": cohen_kappa([x["contains_definition"] for x in first],
                                                 [x["contains_definition"] for x in second]),
        "raw_roles": sum(x["label"] == y["label"] for x, y in zip(first, second)) / len(ids),
        "raw_contains_definition": sum(x["contains_definition"] == y["contains_definition"]
                                       for x, y in zip(first, second)) / len(ids),
        "role_pairs": Counter(f"{x['label']}->{y['label']}" for x, y in zip(first, second)
                              if x["label"] != y["label"]).most_common(12)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sample", type=Path, default=Path("ml/labels/to_label.jsonl"))
    parser.add_argument("--a", type=Path, default=Path("ml/labels/gold_labels.jsonl"))
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    sample = read_jsonl(args.sample)
    order = [row["block_id"] for row in sample]
    a = {row["block_id"]: row for row in read_jsonl(args.a)}
    b = load_b(set(order))
    missing = [i for i in order if i not in b]
    shared = [i for i in order if i in b]
    report = agreement(a, b, shared)
    report["missing_from_b"] = len(missing)
    Path("ml/results/annotator_agreement.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items()}, indent=2))

    disagreements_path = FOLDER / "disagreements.jsonl"
    if not args.finalize:
        text = {row["block_id"]: row for row in sample}
        lines = []
        for i in shared:
            if a[i]["label"] != b[i]["label"] or a[i]["contains_definition"] != b[i]["contains_definition"]:
                lines.append({"block_id": i, "file": text[i]["file"], "page": text[i]["page"],
                              "text": " ".join(text[i]["text"].split()),
                              "a_label": a[i]["label"], "b_label": b[i]["label"],
                              "a_contains": a[i]["contains_definition"], "b_contains": b[i]["contains_definition"],
                              "final_label": None, "final_contains": None})
        disagreements_path.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines),
                                      encoding="utf-8")
        print(f"{len(lines)} disagreements written to {disagreements_path}; {len(missing)} blocks missing from B")
        return

    if missing:
        raise SystemExit(f"{len(missing)} blocks still missing from annotator B")
    decided = {row["block_id"]: row for row in read_jsonl(disagreements_path)}
    undecided = [i for i, row in decided.items()
                 if row["final_label"] not in LABELS or not isinstance(row["final_contains"], bool)]
    if undecided:
        raise SystemExit(f"{len(undecided)} disagreements have no decision yet")
    final = []
    for i in order:
        if i in decided:
            label, contains = decided[i]["final_label"], decided[i]["final_contains"]
            source = "adjudicated"
        else:
            label, contains, source = a[i]["label"], a[i]["contains_definition"], "agreed"
        final.append({"block_id": i, "label": label, "contains_definition": contains or label in ("definition", "notation"),
                      "labelled_at": a[i]["labelled_at"], "source": source})
    out = Path("ml/labels/adjudicated_labels.jsonl")
    out.write_text("".join(json.dumps(row) + "\n" for row in final), encoding="utf-8")
    print(f"Wrote {out}: {Counter(r['source'] for r in final)}")


if __name__ == "__main__":
    main()
