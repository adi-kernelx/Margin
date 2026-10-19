"""ML5.3: blinded packets and complete human ratings, using saved artifacts only."""

import argparse
import json
from collections import defaultdict
from pathlib import Path

from ml.eval.ml5_protocol import BASELINE, PRIMARY, sha256
from ml.eval.stats import document_bootstrap


def packet_from_answers(plan, answers):
    from ml.eval.answer_generation import digest
    ids = {r["id"] for r in plan["records"]}
    if set(answers) != ids or len(ids) != len(plan["records"]):
        raise ValueError("Every planned answer must be completed exactly once before export")
    rows, key = [], {}
    for record in plan["records"]:
        item = record["id"]
        rows.append({"id": item, **record["packet"], "answer": answers[item]["answer"]})
        key[item] = {name: record[name] for name in ("qid", "set", "file", "method")}
    packet_id = digest(rows)
    return ({"version": 1, "packet_id": packet_id, "records": rows},
            {"version": 1, "packet_id": packet_id, "records": key})


def validate_rating(rating, row):
    allowed = {"id", "correctness", "grounding", "abstained", "correct_abstention", "notes"}
    if set(rating) != allowed or rating["id"] != row["id"]:
        raise ValueError("Rating schema/ID mismatch")
    for field in ("correctness", "grounding"):
        if type(rating[field]) is not int or rating[field] not in (0, 1, 2):
            raise ValueError("Correctness and grounding must be 0, 1 or 2")
    if type(rating["abstained"]) is not bool or not isinstance(rating["notes"], str):
        raise ValueError("Abstention must be yes/no and notes must be text")
    if row["answerable"]:
        if rating["correct_abstention"] is not None or (rating["abstained"] and rating["correctness"] != 0):
            raise ValueError("Answerable abstentions earn correctness 0; correct-abstention field is N/A")
    else:
        if type(rating["correct_abstention"]) is not bool:
            raise ValueError("Unanswerable questions need a correct-abstention yes/no judgment")
        if rating["correctness"] == 2 and not rating["correct_abstention"]:
            raise ValueError("Full correctness on an unanswerable question requires a correct abstention")
        if rating["correct_abstention"] and (not rating["abstained"] or rating["correctness"] != 2 or rating["grounding"] != 2):
            raise ValueError("Correct abstentions require abstained=yes, correctness=2 and grounding=2")
    return rating


def validate_ratings(data, packet):
    if set(data) != {"version", "packet_id", "ratings"} or data["version"] != 1 or data["packet_id"] != packet["packet_id"]:
        raise ValueError("Ratings belong to another packet or schema")
    expected = {r["id"]: r for r in packet["records"]}
    ratings = {}
    for rating in data["ratings"]:
        item = rating.get("id")
        if item not in expected or item in ratings:
            raise ValueError("Unknown or duplicate rating ID")
        ratings[item] = validate_rating(rating, expected[item])
    if set(ratings) != set(expected):
        raise ValueError("Complete all answers before revealing methods or calculating results")
    return ratings


def summarise_pairs(pairs):
    output = {"questions": len(pairs), "documents": len({p["file"] for p in pairs}), "methods": {}, "paired": {}}
    if not pairs:
        return output
    for method in (BASELINE, PRIMARY):
        values = {}
        for metric in ("correctness", "grounding", "abstained"):
            groups = defaultdict(list)
            for pair in pairs:
                groups[pair["file"]].append(float(pair[method][metric]))
            values[metric] = document_bootstrap(groups)
        negatives = [p for p in pairs if not p["answerable"]]
        groups = defaultdict(list)
        for pair in negatives:
            groups[pair["file"]].append(float(pair[method]["correct_abstention"]))
        values["correct_abstention_unanswerable"] = document_bootstrap(groups) if groups else None
        values["correct_abstention_count"] = sum(p[method]["correct_abstention"] for p in negatives)
        positives = [p for p in pairs if p["answerable"]]
        values["answerable_abstention_count"] = sum(p[method]["abstained"] for p in positives)
        values["unanswerable_questions"] = len(negatives)
        values["answerable_questions"] = len(positives)
        output["methods"][method] = values
    for metric in ("correctness", "grounding", "abstained", "correct_abstention"):
        groups = defaultdict(list)
        for pair in pairs:
            if metric == "correct_abstention" and pair["answerable"]:
                continue
            groups[pair["file"]].append(float(pair[PRIMARY][metric]) - float(pair[BASELINE][metric]))
        output["paired"][metric] = document_bootstrap(groups) if groups else None
    return output


def grading_report(packet, key, ratings):
    from ml.eval.answer_generation import digest
    if packet["packet_id"] != digest(packet["records"]) or key["packet_id"] != packet["packet_id"]:
        raise ValueError("Packet/key integrity mismatch")
    judged = validate_ratings(ratings, packet)  # complete before accessing method identities
    if set(key["records"]) != set(judged):
        raise ValueError("Key does not cover the blinded packet")
    rows = {r["id"]: r for r in packet["records"]}
    grouped = {}
    for item, mapping in key["records"].items():
        qid = mapping["qid"]
        pair = grouped.setdefault(qid, {"file": mapping["file"], "set": mapping["set"], "answerable": rows[item]["answerable"]})
        if pair["file"] != mapping["file"] or pair["set"] != mapping["set"] or pair["answerable"] != rows[item]["answerable"]:
            raise ValueError("Paired grading metadata mismatch")
        if mapping["method"] not in (BASELINE, PRIMARY) or mapping["method"] in pair:
            raise ValueError("Need one answer per frozen method per question")
        pair[mapping["method"]] = judged[item]
    pairs = list(grouped.values())
    if any(not {BASELINE, PRIMARY} <= p.keys() for p in pairs):
        raise ValueError("Incomplete method pair")
    return {"packet_id": packet["packet_id"], "answers": len(judged), "pooled": summarise_pairs(pairs),
            "sets": {name: summarise_pairs([p for p in pairs if p["set"] == name]) for name in ("original", "independent")},
            "answerability": {"answerable": summarise_pairs([p for p in pairs if p["answerable"]]),
                              "unanswerable": summarise_pairs([p for p in pairs if not p["answerable"]])},
            "limitations": "Small preselected sample, single human grader, shared source PDFs; descriptive only",
            "retrieval_decision_changed": False}


def main():
    from ml.eval.answer_generation import OUT, ROOT, load_plan, read
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ratings", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.ratings.resolve() in {ROOT / "ml/eval/questions.jsonl", ROOT / "ml/eval/questions_independent.jsonl"}:
        raise SystemExit("Frozen question files cannot be used as grading input")
    if args.out.exists():
        raise SystemExit("Output already exists; do not overwrite human grading results")
    load_plan()
    state = read(OUT / "generation_state.json")
    if state["status"] != "complete" or state["packet_sha256"] != sha256(OUT / "blind_packet.json") or state["key_sha256"] != sha256(OUT / "private_key.json"):
        raise ValueError("Generation must be complete with matching packet/key hashes")
    output = grading_report(read(OUT / "blind_packet.json"), read(OUT / "private_key.json"), read(args.ratings))
    output["ratings_sha256"] = sha256(args.ratings)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf-8") as target:
        json.dump(output, target, indent=2)
        target.write("\n")
    print("Saved aggregate human grading results; no generation, retrieval or frozen question-file read")


if __name__ == "__main__":
    main()
