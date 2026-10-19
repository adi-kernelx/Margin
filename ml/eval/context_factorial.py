"""Cached TRAIN 2x2 packing/prompt comparison; --run requires CPU approval."""

import argparse
import copy
import json
import random
import statistics
from collections import defaultdict
from pathlib import Path

from ml.eval import answer_generation as gen, answer_grading as grading
from ml.eval import context_quality as quality, context_revision as revision, grounded_prompt
from ml.eval.stats import document_bootstrap

ROOT = gen.ROOT
OUT = ROOT / "ml/out/context_factorial"
RUNTIME_REPORT = ROOT / "ml/results/context_factorial_train_runtime.json"
QUALITY_REPORT = ROOT / "ml/results/context_factorial_train.json"
OPTIONS = dict(revision.OPTIONS)
METHODS = {"full_original": ("full", "original"), "full_grounded": ("full", "grounded"),
           "selected_original": ("bounded", "original"), "selected_grounded": ("bounded", "grounded")}
CONTRASTS = {
    "packing_at_original_prompt": {"selected_original": 1, "full_original": -1},
    "packing_at_grounded_prompt": {"selected_grounded": 1, "full_grounded": -1},
    "prompt_at_full_context": {"full_grounded": 1, "full_original": -1},
    "prompt_at_selected_context": {"selected_grounded": 1, "selected_original": -1},
    "combined_vs_full_original": {"selected_grounded": 1, "full_original": -1},
    "packing_main_effect": {"selected_original": .5, "selected_grounded": .5, "full_original": -.5, "full_grounded": -.5},
    "prompt_main_effect": {"full_grounded": .5, "selected_grounded": .5, "full_original": -.5, "selected_original": -.5},
    "interaction": {"selected_grounded": 1, "selected_original": -1, "full_grounded": -1, "full_original": 1},
}
SOURCES = (*revision.SOURCES, "ml/eval/context_factorial.py", "docs/ML5_CONTEXT_FACTORIAL.md")
LIMITATIONS = ("Diagnostic 2x2 study of ten previously reviewed, assistant-authored TRAIN cases over four PDFs, "
               "including two synthetic unsupported probes. No independent holdout or representative traffic. "
               "One fresh generation per condition/question, no generation seed, limited reviewer independence "
               "and partial blinding. Document-bootstrap intervals use few clusters and multiple exploratory "
               "contrasts without multiplicity correction. Counterbalanced order does not eliminate cache, "
               "carryover or output-length effects. No automatic live change or population claim.")


def protected_hashes():
    hashes = revision.protected_hashes()
    if (revision.OUT / "generation.lock").exists():
        raise ValueError("Previous revision must be stopped")
    for name in ("study.json", "preparation.json", "plan.json", "plan_seal.json", "answers.jsonl",
                 "generation_state.json", "blind_packet.json", "private_key.json", "ratings.assistant.json", "grading_receipt.json"):
        path = revision.OUT / name
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    for path in (revision.RUNTIME_REPORT, revision.QUALITY_REPORT):
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    return hashes


def cached_pairs(study, prior):
    """Verify exact saved TRAIN inputs; do not reconstruct retrieval or packing."""
    original, _ = gen.prompt_modules()
    questions = {q["qid"]: q for q in study["questions"]}
    if len(questions) != len(study["questions"]):
        raise ValueError("Duplicate TRAIN question")
    pairs = {qid: {} for qid in questions}
    for r in prior["records"]:
        q, method = questions.get(r["qid"]), r["method"]
        if (not q or q["split"] != "train" or r["set"] != "train" or r["file"] != q["file"]
                or method not in {"full", "bounded"} or method in pairs[r["qid"]]):
            raise ValueError("Need unique cached TRAIN context pairs")
        packet = r["packet"]
        expected = {"question": q["question"], "source_file": q["file"], "answerable": q["answerable"],
                    "answer_pages": sorted({ref["page"] for ref in q["references"]}),
                    "answer_quote": "\n\n".join(ref["quote"] for ref in q["references"])}
        if any(packet[k] != v for k, v in expected.items()):
            raise ValueError("Cached TRAIN question/reference metadata changed")
        contexts = packet["contexts"]
        count, budget = (8, 18000) if method == "full" else (6, 4000)
        if len(contexts) > count or sum(len(c["text"].encode("utf-8")) for c in contexts) > budget:
            raise ValueError("Cached contexts exceed original limits")
        expected_prompt = (original.build_prompt(q["question"], contexts, mode="qa") if method == "full"
                           else grounded_prompt.build_prompt(q["question"], contexts))
        if r["prompt"] != expected_prompt:
            raise ValueError("Cached prompt no longer matches frozen context/prompt construction")
        pairs[q["qid"]][method] = packet
    if any(set(pair) != {"full", "bounded"} for pair in pairs.values()):
        raise ValueError("Incomplete cached TRAIN pairs")
    return pairs


def build_records(study, prior):
    pairs = cached_pairs(study, prior)
    original, _ = gen.prompt_modules()
    rng = random.Random(20261020)
    questions = list(study["questions"])
    rng.shuffle(questions)
    identities = list(METHODS)
    rng.shuffle(identities)
    # Eight core blocks balance positions and directed predecessors. Two extra
    # blocks add rows 0/1; each condition appears 2 or 3 times per slot overall.
    orders = ((0, 1, 3, 2), (1, 2, 0, 3), (2, 3, 1, 0), (3, 0, 2, 1))
    schedule = [i % 4 for i in range(len(questions))]
    rng.shuffle(schedule)
    records, evidence = [], []
    for q, row in zip(questions, schedule):
        pair = pairs[q["qid"]]
        evidence.append({"qid": q["qid"], "answerable": q["answerable"],
                         **{variant: quality.reference_retention(q["references"], packet["contexts"])
                            for variant, packet in pair.items()}})
        for index in orders[row]:
            method = identities[index]
            packing, prompting = METHODS[method]
            packet = copy.deepcopy(pair[packing])
            prompt = (original.build_prompt(q["question"], packet["contexts"], mode="qa") if prompting == "original"
                      else grounded_prompt.build_prompt(q["question"], packet["contexts"]))
            if len((study["system"] + prompt).encode("utf-8")) + 1024 > OPTIONS["num_ctx"]:
                raise ValueError("Factorial prompt exceeds conservative context allowance")
            records.append({"id": f"A{len(records)+1:03d}", "qid": q["qid"], "set": "train", "file": q["file"],
                            "method": method, "packet": packet, "prompt": prompt})
    return records, evidence


def prepare(out=OUT):
    before = protected_hashes()
    study = revision.load_study()
    train_files = set(gen.read(ROOT / "ml/models/artifacts/ml5/protocol.json")["train_files"])
    if (len(study["questions"]) != 10 or len({q["file"] for q in study["questions"]}) != 4
            or sum(q["answerable"] for q in study["questions"]) != 8
            or any(q["split"] != "train" or q["file"] not in train_files for q in study["questions"])):
        raise ValueError("Need the ten sealed TRAIN cases, eight answerable, four PDFs")
    prior_path = revision.OUT / "plan.json"
    state = gen.read(revision.OUT / "generation_state.json")
    prior = gen.read(prior_path)
    if (state["status"] != "complete" or gen.digest(prior) != state["plan_sha256"]
            or gen.sha256(prior_path) != gen.read(revision.OUT / "plan_seal.json")["plan_sha256"]
            or prior["study_sha256"] != gen.digest(study)):
        raise ValueError("Previous TRAIN plan/state seal mismatch")
    records, evidence = build_records(study, prior)
    plan = {"version": 1, "created_at": gen.now(), "model": study["model"], "identity": study["identity"],
            "model_digest": study["identity"]["digest"], "server_identity": study["server_identity"],
            "system": study["system"], "options": OPTIONS, "methods": METHODS, "contrasts": CONTRASTS,
            "questions": study["questions"], "records": records, "evidence": evidence,
            "sources": {**study["sources"], **{name: gen.sha256(ROOT / name) for name in SOURCES}},
            "protected": before, "limitations": LIMITATIONS}
    if protected_hashes() != before:
        raise ValueError("Protected experiments changed during preparation")
    out.mkdir(parents=True, exist_ok=True)
    gen.write_new(out / "plan.json", plan)
    gen.write_new(out / "preparation.json", {"plan_sha256": gen.sha256(out / "plan.json")})
    return plan


def load_plan(out=OUT):
    plan = gen.read(out / "plan.json")
    if (gen.sha256(out / "plan.json") != gen.read(out / "preparation.json")["plan_sha256"]
            or plan["options"] != OPTIONS or plan["methods"] != {k: list(v) for k, v in METHODS.items()}
            or plan["contrasts"] != CONTRASTS or len(plan["records"]) != 40
            or plan["model"] != gen.MODEL or plan["identity"] != gen.local_model_identity()
            or plan["model_digest"] != plan["identity"]["digest"]
            or any(gen.sha256(ROOT / name) != value for name, value in plan["sources"].items())
            or protected_hashes() != plan["protected"]):
        raise ValueError("Factorial plan, source, model or protected experiments changed")
    return plan


def runtime_report(plan, answers):
    samples = defaultdict(list)
    audits = defaultdict(list)
    for r in plan["records"]:
        event = answers[r["id"]]
        m = event["metrics"]
        samples[r["method"]].append({"first_text_seconds": event["first_text_seconds"], "wall_seconds": event["wall_seconds"],
                                     "prompt_seconds": m["prompt_eval_duration"]/1e9, "output_seconds": m["eval_duration"]/1e9,
                                     "prompt_tokens": m["prompt_eval_count"], "output_tokens": m["eval_count"],
                                     "length_stop": event["done_reason"] == "length"})
        audits[r["method"]].append(grounded_prompt.citation_audit(event["answer"], len(r["packet"]["contexts"])))
    fields = ("first_text_seconds", "wall_seconds", "prompt_seconds", "output_seconds", "prompt_tokens", "output_tokens")
    timing = {method: {"requests": len(values), "means": {f: statistics.mean(v[f] for v in values) for f in fields},
                       "length_stops": sum(v["length_stop"] for v in values)} for method, values in samples.items()}
    positives = [e for e in plan["evidence"] if e["answerable"]]
    return {"status": "generation_complete_grading_pending", "questions": len(plan["questions"]), "answers": len(answers),
            "documents": len({q["file"] for q in plan["questions"]}), "options": plan["options"], "timing": timing,
            "answerable_questions": len(positives), "unsupported_probes": len(plan["evidence"]) - len(positives),
            "complete_reference_questions": {v: sum(all(e[v]) for e in positives) for v in ("full", "bounded")},
            "additional_reference_losses": sum(all(e["full"]) and not all(e["bounded"]) for e in positives),
            "citation_syntax": {method: {"invalid_mentions": sum(a["invalid_mentions"] for a in values),
                                         "answers_without_citation": sum(a["no_citation"] for a in values),
                                         "semantic_support_assessed": False} for method, values in audits.items()},
            "quality_assessed": False, "live_defaults_changed": False, "limitations": LIMITATIONS}


def execute(plan, out=OUT, report=RUNTIME_REPORT, engine=None):
    if report.exists():
        raise FileExistsError("Factorial runtime report exists; do not regenerate")
    if protected_hashes() != plan["protected"]:
        raise ValueError("Protected experiments changed")
    engine = engine or quality.QualityOllama(plan["server_identity"])
    if engine.identity() != plan["server_identity"]:
        raise ValueError("Running model/version differs from sealed plan")
    state = gen.execute(plan, out, engine=engine)
    if state["status"] != "complete" or protected_hashes() != plan["protected"]:
        raise ValueError("Incomplete generation or changed protected experiments")
    answers = gen.journal_answers(out / "answers.jsonl", plan["records"], gen.digest(plan))
    output = runtime_report(plan, answers)
    output.update(plan_sha256=gen.digest(plan), journal_sha256=state["journal_sha256"],
                  packet_sha256=state["packet_sha256"], identity=state["identity"], recorded_at=gen.now())
    gen.write_new(report, output)
    return output


def score(packet, key, ratings, questions):
    if packet["packet_id"] != gen.digest(packet["records"]) or key["packet_id"] != packet["packet_id"]:
        raise ValueError("Packet/key integrity mismatch")
    judged = grading.validate_ratings(ratings, packet)
    if set(judged) != set(key["records"]):
        raise ValueError("Key does not cover the packet")
    rows = {r["id"]: r for r in packet["records"]}
    qs = {q["qid"]: q for q in questions}
    pairs = {}
    for item, mapping in key["records"].items():
        q, row = qs.get(mapping["qid"]), rows[item]
        if (not q or q["split"] != "train" or mapping["set"] != "train" or mapping["file"] != q["file"]
                or row["source_file"] != q["file"] or row["question"] != q["question"] or row["answerable"] != q["answerable"]):
            raise ValueError("Paired TRAIN metadata mismatch")
        pair = pairs.setdefault(q["qid"], {"file": q["file"], "answerable": q["answerable"], "cohort": q["cohort"], "ratings": {}})
        method = mapping["method"]
        if method not in METHODS or method in pair["ratings"]:
            raise ValueError("Need one answer per factorial condition")
        pair["ratings"][method] = judged[item]
    if set(pairs) != set(qs) or any(set(p["ratings"]) != set(METHODS) for p in pairs.values()):
        raise ValueError("Incomplete four-condition TRAIN blocks")

    def summarize(selected):
        result = {"questions": len(selected), "documents": len({p["file"] for p in selected}), "metrics": {}}
        for metric in ("correctness", "grounding"):
            means, effects = {}, {}
            for method in METHODS:
                groups = defaultdict(list)
                for p in selected:
                    groups[p["file"]].append(p["ratings"][method][metric])
                means[method] = document_bootstrap(groups)
            for name, weights in CONTRASTS.items():
                groups = defaultdict(list)
                for p in selected:
                    groups[p["file"]].append(sum(w*p["ratings"][method][metric] for method, w in weights.items()))
                effects[name] = document_bootstrap(groups)
                if len(weights) == 2:
                    effects[name]["regressions"] = sum(sum(w*p["ratings"][method][metric] for method, w in weights.items()) < 0 for p in selected)
            result["metrics"][metric] = {"means": means, "effects": effects}
        return result

    values = list(pairs.values())
    output = summarize(values)
    output["cohorts"] = {name: summarize([p for p in values if p["cohort"] == name]) for name in sorted({p["cohort"] for p in values})}
    output["correct_abstention"] = {}
    for method in METHODS:
        groups = defaultdict(list)
        for p in values:
            if not p["answerable"]:
                groups[p["file"]].append(int(p["ratings"][method]["correct_abstention"]))
        output["correct_abstention"][method] = document_bootstrap(groups) if groups else None
    output["candidate_checks"] = {}
    for method in METHODS:
        if method == "full_original":
            continue
        regressions = {metric: sum(p["ratings"][method][metric] < p["ratings"]["full_original"][metric] for p in values)
                       for metric in ("correctness", "grounding")}
        errors = sum(not p["ratings"][method]["correct_abstention"] for p in values if not p["answerable"])
        output["candidate_checks"][method] = {"regressions_against_full_original": regressions, "unsupported_errors": errors}
    output.update(title="TRAIN packing and prompt factorial comparison", quality_assessed=True,
                  decision="diagnostic_only_no_live_change", live_defaults_changed=False, limitations=LIMITATIONS)
    return output


def score_review(ratings_path, out=OUT, runtime_path=RUNTIME_REPORT, report=QUALITY_REPORT):
    reject_frozen_path(ratings_path)
    if report.exists():
        raise FileExistsError("Factorial quality report exists")
    state = gen.read(out / "generation_state.json")
    if (state["status"] != "complete" or state["packet_sha256"] != gen.sha256(out / "blind_packet.json")
            or state["key_sha256"] != gen.sha256(out / "private_key.json")):
        raise ValueError("Complete generation with unchanged blind exports required")
    packet, ratings = gen.read(out / "blind_packet.json"), gen.read(ratings_path)
    grading.validate_ratings(ratings, packet)
    if packet["packet_id"] != gen.digest(packet["records"]):
        raise ValueError("Packet integrity mismatch")
    receipt = {"at": gen.now(), "ratings_sha256": gen.sha256(ratings_path), "ratings_count": len(ratings["ratings"]),
               "packet_sha256": state["packet_sha256"], "key_sha256": state["key_sha256"],
               "rubric_sha256": gen.sha256(ROOT / "docs/ML5_GRADING.md"), "reviewer": "assistant", "human_validation": False,
               "methodology": "Complete ratings saved before plan/key access; partial blinding, all cases previously seen, shared authorship"}
    gen.write_new(out / "grading_receipt.json", receipt)
    plan = load_plan(out)
    runtime = gen.read(runtime_path)
    if (gen.digest(plan) != state["plan_sha256"] or gen.sha256(out / "answers.jsonl") != state["journal_sha256"]
            or any(runtime[k] != state[k] for k in ("plan_sha256", "journal_sha256", "packet_sha256"))):
        raise ValueError("Completed plan, journal or runtime report changed")
    output = score(packet, gen.read(out / "private_key.json"), ratings, plan["questions"])
    for method, check in output["candidate_checks"].items():
        extra_loss = runtime["additional_reference_losses"] if METHODS[method][0] == "bounded" else 0
        check.update(additional_reference_losses=extra_loss,
                     status="hold" if any(check["regressions_against_full_original"].values()) or check["unsupported_errors"] or extra_loss
                     else "passes_small_screen_only")
    output.update(packet_id=packet["packet_id"], grading=receipt, grading_receipt_sha256=gen.sha256(out / "grading_receipt.json"),
                  runtime_report_sha256=gen.sha256(runtime_path), plan_sha256=gen.digest(plan))
    gen.write_new(report, output)
    return output


def reject_frozen_path(path):
    if Path(path).resolve() in {ROOT / "ml/eval/questions.jsonl", ROOT / "ml/eval/questions_independent.jsonl"}:
        raise ValueError("Frozen question files cannot be ratings")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--run", action="store_true")
    mode.add_argument("--score", type=Path, metavar="RATINGS")
    args = parser.parse_args()
    if args.score:
        reject_frozen_path(args.score)
    if args.prepare:
        print(f"Prepared {len(prepare()['records'])} cached TRAIN requests; no model loaded")
    elif args.check:
        load_plan()
        print("Factorial plan and protected experiments match; no model loaded")
    elif args.run:
        print(json.dumps(execute(load_plan()), indent=2))
    else:
        print(json.dumps(score_review(args.score), indent=2))


if __name__ == "__main__":
    main()
