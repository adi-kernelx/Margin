"""Three-way cached TRAIN check; unchanged original prompt, CPU approval required."""

import argparse
import copy
import itertools
import json
import random
import statistics
from collections import defaultdict
from pathlib import Path

from ml.eval import answer_generation as gen, answer_grading as grading, context_quality as quality
from ml.eval import context_factorial as factorial, grounded_prompt
from ml.eval.stats import document_bootstrap
from ml.retrieval.focused_contexts import select_contexts

ROOT = gen.ROOT
OUT = ROOT / "ml/out/context_refinement"
RUNTIME_REPORT = ROOT / "ml/results/context_refinement_train_runtime.json"
QUALITY_REPORT = ROOT / "ml/results/context_refinement_train.json"
OPTIONS = dict(factorial.OPTIONS)
METHODS = ("full_original", "previous_original", "refined_original")
COMPARISONS = {"refined_vs_full": ("full_original", "refined_original"),
               "refined_vs_previous": ("previous_original", "refined_original"),
               "previous_vs_full": ("full_original", "previous_original")}
SOURCES = (*factorial.SOURCES, "ml/retrieval/focused_contexts.py", "ml/eval/context_refinement.py", "docs/ML5_CONTEXT_REFINEMENT.md")
LIMITATIONS = ("Ten previously reviewed assistant-authored TRAIN cases over four PDFs, including two synthetic unsupported probes. "
               "One fresh generation per condition/question, no generation seed, partial blinding/shared authorship and prior familiarity. "
               "Four document clusters and multiple unadjusted document-bootstrap intervals make this exploratory. "
               "Reference retention is lexical, not semantic support. Order/cache/output lengths affect timing. "
               "No independent holdout, noninferiority, population or live-default claim.")


def protected_hashes():
    hashes = factorial.protected_hashes()
    if (factorial.OUT / "generation.lock").exists():
        raise ValueError("Factorial generation must be stopped")
    for name in ("plan.json", "preparation.json", "answers.jsonl", "generation_state.json", "blind_packet.json",
                 "private_key.json", "ratings.assistant.json", "grading_receipt.json"):
        path = factorial.OUT / name
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    for path in (factorial.RUNTIME_REPORT, factorial.QUALITY_REPORT):
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    return hashes


def build_records(prior):
    prompt, _ = gen.prompt_modules()
    questions = {q["qid"]: q for q in prior["questions"]}
    if len(questions) != len(prior["questions"]) or any(q["split"] != "train" for q in questions.values()):
        raise ValueError("Need unique TRAIN cases")
    cached = {qid: {} for qid in questions}
    for r in prior["records"]:
        if r["method"] not in ("full_original", "selected_original"):
            continue
        q = questions.get(r["qid"])
        if (not q or r["set"] != "train" or r["file"] != q["file"] or r["method"] in cached[r["qid"]]):
            raise ValueError("Cached TRAIN source mismatch or duplicate")
        packet = r["packet"]
        expected = {"question": q["question"], "source_file": q["file"], "answerable": q["answerable"],
                    "answer_pages": sorted({ref["page"] for ref in q["references"]}),
                    "answer_quote": "\n\n".join(ref["quote"] for ref in q["references"])}
        if any(packet[k] != v for k, v in expected.items()) or r["prompt"] != prompt.build_prompt(q["question"], packet["contexts"], mode="qa"):
            raise ValueError("Cached metadata or original prompt changed")
        cached[q["qid"]][r["method"]] = packet
    if any(set(pair) != {"full_original", "selected_original"} for pair in cached.values()):
        raise ValueError("Incomplete cached context pairs")
    rng = random.Random(20261021)
    qs, identities = list(questions.values()), list(METHODS)
    rng.shuffle(qs)
    rng.shuffle(identities)
    orders = list(itertools.permutations(range(3)))
    # Six orders plus a cyclic trio and one extra: each slot has 3/4 uses per method.
    schedule = ([0, 1, 2, 3, 4, 5, 0, 3, 4, 0] * ((len(qs)+9)//10))[:len(qs)]
    rng.shuffle(schedule)
    records, evidence = [], []
    for q, order in zip(qs, schedule):
        pair = cached[q["qid"]]
        packets = {"full_original": copy.deepcopy(pair["full_original"]),
                   "previous_original": copy.deepcopy(pair["selected_original"])}
        refined = select_contexts(q["question"], pair["full_original"]["contexts"])
        if len(refined) > 4 or sum(len(c["text"].encode()) for c in refined) > 4000:
            raise ValueError("Refined context budget exceeded")
        packets["refined_original"] = {**copy.deepcopy(pair["full_original"]), "contexts": refined}
        evidence.append({"qid": q["qid"], "answerable": q["answerable"],
                         **{m: quality.reference_retention(q["references"], p["contexts"]) for m, p in packets.items()}})
        for index in orders[order]:
            method = identities[index]
            packet = packets[method]
            text = prompt.build_prompt(q["question"], packet["contexts"], mode="qa")
            if len((prior["system"] + text).encode()) + 1024 > OPTIONS["num_ctx"]:
                raise ValueError("Refinement prompt exceeds conservative allowance")
            records.append({"id": f"A{len(records)+1:03d}", "qid": q["qid"], "file": q["file"], "set": "train",
                            "method": method, "packet": packet, "prompt": text})
    return records, evidence


def prepare(out=OUT):
    before = protected_hashes()
    prior = factorial.load_plan()
    train = set(gen.read(ROOT / "ml/models/artifacts/ml5/protocol.json")["train_files"])
    if (len(prior["questions"]) != 10 or len({q["file"] for q in prior["questions"]}) != 4
            or sum(q["answerable"] for q in prior["questions"]) != 8
            or any(q["split"] != "train" or q["file"] not in train for q in prior["questions"])):
        raise ValueError("Need the ten sealed TRAIN cases, eight answerable, four PDFs")
    state = gen.read(factorial.OUT / "generation_state.json")
    if state["status"] != "complete" or state["plan_sha256"] != gen.digest(prior):
        raise ValueError("Previous factorial plan/state mismatch")
    records, evidence = build_records(prior)
    plan = {"version": 1, "created_at": gen.now(), "model": prior["model"], "identity": prior["identity"],
            "model_digest": prior["model_digest"], "server_identity": prior["server_identity"], "options": OPTIONS,
            "system": prior["system"], "questions": prior["questions"], "records": records, "evidence": evidence,
            "methods": METHODS, "comparisons": COMPARISONS, "limitations": LIMITATIONS, "protected": before,
            "sources": {**prior["sources"], **{p: gen.sha256(ROOT / p) for p in SOURCES}}}
    if protected_hashes() != before:
        raise ValueError("Protected experiments changed during preparation")
    out.mkdir(parents=True, exist_ok=True)
    gen.write_new(out / "plan.json", plan)
    gen.write_new(out / "preparation.json", {"plan_sha256": gen.sha256(out / "plan.json")})
    return plan


def load_plan(out=OUT):
    plan = gen.read(out / "plan.json")
    if (gen.sha256(out / "plan.json") != gen.read(out / "preparation.json")["plan_sha256"]
            or plan["options"] != OPTIONS or plan["methods"] != list(METHODS)
            or plan["comparisons"] != {k: list(v) for k, v in COMPARISONS.items()} or len(plan["records"]) != 30
            or plan["model"] != gen.MODEL or plan["identity"] != gen.local_model_identity()
            or plan["model_digest"] != plan["identity"]["digest"]
            or any(gen.sha256(ROOT / p) != v for p, v in plan["sources"].items()) or protected_hashes() != plan["protected"]):
        raise ValueError("Refinement plan, source, model or protected experiments changed")
    return plan


def runtime_report(plan, answers):
    # Reuse the sealed generic timing collector; replace its two-level evidence
    # labels/counts and limitations with the actual three-condition design.
    adapted = {**plan, "evidence": [{**e, "full": e["full_original"], "bounded": e["refined_original"]} for e in plan["evidence"]]}
    output = factorial.runtime_report(adapted, answers)
    positive = [e for e in plan["evidence"] if e["answerable"]]
    output.update(complete_reference_questions={m: sum(all(e[m]) for e in positive) for m in METHODS},
                  additional_reference_losses={m: sum(all(e["full_original"]) and not all(e[m]) for e in positive) for m in METHODS[1:]},
                  context_text_bytes={m: {"mean": statistics.mean(sum(len(c["text"].encode()) for c in r["packet"]["contexts"])
                                                                            for r in plan["records"] if r["method"] == m)} for m in METHODS},
                  limitations=LIMITATIONS)
    return output


def execute(plan, out=OUT, report=RUNTIME_REPORT, engine=None):
    if report.exists():
        raise FileExistsError("Refinement runtime report exists; do not regenerate")
    if protected_hashes() != plan["protected"]:
        raise ValueError("Protected experiments changed")
    engine = engine or quality.QualityOllama(plan["server_identity"])
    if engine.identity() != plan["server_identity"]:
        raise ValueError("Running model/version differs from sealed plan")
    state = gen.execute(plan, out, engine=engine)
    if state["status"] != "complete" or protected_hashes() != plan["protected"]:
        raise ValueError("Incomplete generation or changed protected experiments")
    output = runtime_report(plan, gen.journal_answers(out / "answers.jsonl", plan["records"], gen.digest(plan)))
    output.update(plan_sha256=gen.digest(plan), journal_sha256=state["journal_sha256"],
                  packet_sha256=state["packet_sha256"], identity=state["identity"], recorded_at=gen.now())
    gen.write_new(report, output)
    return output


def score(packet, key, ratings, questions):
    if packet["packet_id"] != gen.digest(packet["records"]) or key["packet_id"] != packet["packet_id"]:
        raise ValueError("Packet/key integrity mismatch")
    judged = grading.validate_ratings(ratings, packet)
    if set(judged) != set(key["records"]):
        raise ValueError("Key does not cover packet")
    rows = {r["id"]: r for r in packet["records"]}
    qs, pairs = {q["qid"]: q for q in questions}, {}
    for item, mapping in key["records"].items():
        q, row = qs.get(mapping["qid"]), rows[item]
        if (not q or q["split"] != "train" or mapping["set"] != "train" or mapping["file"] != q["file"]
                or row["question"] != q["question"] or row["source_file"] != q["file"] or row["answerable"] != q["answerable"]):
            raise ValueError("Paired TRAIN metadata mismatch")
        pair = pairs.setdefault(q["qid"], {})
        method = mapping["method"]
        if method not in METHODS or method in pair:
            raise ValueError("Need one answer per refinement condition")
        pair[method] = judged[item]
    if set(pairs) != set(qs) or any(set(p) != set(METHODS) for p in pairs.values()):
        raise ValueError("Incomplete three-condition TRAIN blocks")

    def summarize(qids):
        result = {"questions": len(qids), "documents": len({qs[q]["file"] for q in qids}), "metrics": {}}
        for metric in ("correctness", "grounding"):
            means, comparisons = {}, {}
            for method in METHODS:
                groups = defaultdict(list)
                for qid in qids:
                    groups[qs[qid]["file"]].append(pairs[qid][method][metric])
                means[method] = document_bootstrap(groups)
            for name, (baseline, candidate) in COMPARISONS.items():
                groups = defaultdict(list)
                for qid in qids:
                    groups[qs[qid]["file"]].append(pairs[qid][candidate][metric] - pairs[qid][baseline][metric])
                comparisons[name] = {**document_bootstrap(groups), "regressions": sum(pairs[q][candidate][metric] < pairs[q][baseline][metric] for q in qids)}
            result["metrics"][metric] = {"means": means, "comparisons": comparisons}
        return result

    output = summarize(list(qs))
    output["cohorts"] = {c: summarize([q for q in qs if qs[q]["cohort"] == c]) for c in sorted({q["cohort"] for q in questions})}
    output["correct_abstention"] = {}
    for method in METHODS:
        groups = defaultdict(list)
        for qid, q in qs.items():
            if not q["answerable"]:
                groups[q["file"]].append(int(pairs[qid][method]["correct_abstention"]))
        output["correct_abstention"][method] = document_bootstrap(groups) if groups else None
    output.update(quality_assessed=True, live_defaults_changed=False, limitations=LIMITATIONS)
    return output


def score_review(ratings_path, out=OUT, runtime_path=RUNTIME_REPORT, report=QUALITY_REPORT):
    factorial.reject_frozen_path(ratings_path)
    if report.exists():
        raise FileExistsError("Refinement quality report exists")
    state = gen.read(out / "generation_state.json")
    if (state["status"] != "complete" or state["packet_sha256"] != gen.sha256(out / "blind_packet.json")
            or state["key_sha256"] != gen.sha256(out / "private_key.json")):
        raise ValueError("Complete generation and unchanged blind exports required")
    packet, ratings = gen.read(out / "blind_packet.json"), gen.read(ratings_path)
    judged = grading.validate_ratings(ratings, packet)
    if packet["packet_id"] != gen.digest(packet["records"]):
        raise ValueError("Packet integrity mismatch")
    receipt = {"at": gen.now(), "ratings_sha256": gen.sha256(ratings_path), "ratings_count": len(judged),
               "packet_sha256": state["packet_sha256"], "key_sha256": state["key_sha256"],
               "rubric_sha256": gen.sha256(ROOT / "docs/ML5_GRADING.md"), "reviewer": "assistant", "human_validation": False,
               "methodology": "All ratings saved before plan/key access; prior familiarity, shared authorship and partial blinding"}
    gen.write_new(out / "grading_receipt.json", receipt)
    plan = load_plan(out)
    runtime = gen.read(runtime_path)
    if (gen.digest(plan) != state["plan_sha256"] or gen.sha256(out / "answers.jsonl") != state["journal_sha256"]
            or any(runtime[k] != state[k] for k in ("plan_sha256", "journal_sha256", "packet_sha256"))):
        raise ValueError("Completed plan/journal/runtime changed")
    key = gen.read(out / "private_key.json")
    output = score(packet, key, ratings, plan["questions"])
    regressions = {metric: {name: output["metrics"][metric]["comparisons"][name]["regressions"] for name in ("refined_vs_full", "refined_vs_previous")}
                   for metric in ("correctness", "grounding")}
    negatives = {q["qid"] for q in plan["questions"] if not q["answerable"]}
    errors = sum(not judged[i]["correct_abstention"] for i, m in key["records"].items() if m["method"] == "refined_original" and m["qid"] in negatives)
    losses = runtime["additional_reference_losses"]["refined_original"]
    blocked = errors or losses or any(v for counts in regressions.values() for v in counts.values())
    output.update(title="TRAIN original-prompt excerpt refinement", grading=receipt, packet_id=packet["packet_id"],
                  regressions=regressions, unsupported_errors=errors, additional_reference_losses=losses,
                  decision="hold_refinement" if blocked else "screen_passed_further_validation_required",
                  runtime_report_sha256=gen.sha256(runtime_path), grading_receipt_sha256=gen.sha256(out / "grading_receipt.json"))
    gen.write_new(report, output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--run", action="store_true")
    mode.add_argument("--score", type=Path)
    args = parser.parse_args()
    if args.score:
        factorial.reject_frozen_path(args.score)
    if args.prepare:
        print(f"Prepared {len(prepare()['records'])} TRAIN requests; no model loaded")
    elif args.check:
        load_plan()
        print("Refinement plan, sources and protected checkpoints match; no model loaded")
    elif args.run:
        print(json.dumps(execute(load_plan()), indent=2))
    else:
        print(json.dumps(score_review(args.score), indent=2))


if __name__ == "__main__":
    main()
