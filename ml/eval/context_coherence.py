"""One bounded broader TRAIN comparison; --run needs explicit CPU approval."""

import argparse
import copy
import csv
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

from ml.eval import answer_generation as gen, answer_grading as grading
from ml.eval import context_quality as quality, context_refinement as prior, context_factorial as factorial
from ml.eval import context_revision as revision, grounded_prompt, llm_latency as latency
from ml.eval.stats import document_bootstrap
from ml.eval.validate_questions import compact, group_splits
from ml.retrieval.coherent_contexts import select_contexts

ROOT = gen.ROOT
OUT = ROOT / "ml/out/context_coherence"
RUNTIME_REPORT = ROOT / "ml/results/context_coherence_train_runtime.json"
QUALITY_REPORT = ROOT / "ml/results/context_coherence_train.json"
OPTIONS = dict(prior.OPTIONS)
VARIANTS = {"full": {"contexts": 8, "bytes": 18000, "prompt": "original"},
            "bounded": {"contexts": 4, "bytes": 4000, "prompt": "original"}}
SENTINELS = ("Q002", "Q004", "Q006", "Q008")
NETWORK = "Chapter_1.pdf"
DESCENT = "Steepest_Descent_Method_23 rd March 2026.pdf"
# Native line slices or bundle metadata become private references at preparation.
FRESH = (
    (quality.SIPSER, "May a simple path revisit a node, according to this text?", "simple-path", None, None),
    (quality.KKT, "If constraint qualification is violated at the optimum, do these notes say the equations necessarily lack a solution?", None, 27, (7, 9)),
    ("Decision_Trees_AI.pdf", "How does post-pruning decide whether to remove nodes, and is its validation set the training set?", None, 34, (11, 20)),
    (revision.CLASSIFICATION, "Why can sparse training coverage in a region cause incorrect predictions by a decision tree?", None, 55, (1, 6)),
    (NETWORK, "Which message properties and event responses does a network protocol specify?", None, 10, (9, 13)),
    (NETWORK, "Does HFC cable access have equal upstream and downstream rates, and does each home have a dedicated link to the cable headend?", None, 18, (9, 14)),
    (DESCENT, "Which direction increases the function value fastest, and what is that direction called?", None, 2, (17, 20)),
    (DESCENT, "How is the condition number r of Q expressed using its extreme eigenvalues and its matrix norms?", None, 34, (3, 6)),
)
SOURCES = (*prior.SOURCES, "ml/retrieval/coherent_contexts.py", "ml/eval/context_coherence.py", "docs/ML5_CONTEXT_COHERENCE.md")
LIMITATIONS = ("Eighteen assistant-authored TRAIN cases over six PDFs: four previously reviewed sentinels, "
               "eight fresh answerable prompts and six synthetic unsupported probes. Fresh means new to this screen, "
               "not independent authorship or a holdout. One output per condition, partial blinding, shared authorship "
               "and six document clusters limit inference. Document-bootstrap intervals are exploratory. "
               "Quote retention is lexical; timing includes cache/order effects. No live-default or population claim.")


def protected_hashes():
    hashes = prior.protected_hashes()
    if (prior.OUT / "generation.lock").exists():
        raise ValueError("Refinement generation must be stopped")
    for name in ("plan.json", "preparation.json", "answers.jsonl", "generation_state.json", "blind_packet.json",
                 "private_key.json", "ratings.assistant.json", "grading_receipt.json"):
        path = prior.OUT / name
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    for path in (prior.RUNTIME_REPORT, prior.QUALITY_REPORT):
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    return hashes


def validate_train(files):
    with (ROOT / "Test PDFs/manifest.csv").open(encoding="utf-8") as stream:
        manifest = {row["file"]: row for row in csv.DictReader(stream)}
    splits = group_splits(gen.read(ROOT / "ml/splits.json"))
    train = set(gen.read(ROOT / "ml/models/artifacts/ml5/protocol.json")["train_files"])
    if any(Path(f).name != f or f not in train or f not in manifest or splits.get(manifest[f]["group"]) != "train" for f in files):
        raise ValueError("Every source must be a canonical frozen TRAIN PDF")
    return manifest


def training_questions(previous):
    import pymupdf
    import yaml
    selected = [copy.deepcopy(q) for q in previous["questions"] if q["qid"] in SENTINELS]
    if len(selected) != 4 or {q["qid"] for q in selected} != set(SENTINELS):
        raise ValueError("Need all four cached sentinels")
    files = sorted({q["file"] for q in selected} | {spec[0] for spec in FRESH})
    manifest = validate_train(files)  # Validate all files before opening any PDF/bundle.
    sources, pages = {}, {}
    for file in files:
        path = ROOT / "Test PDFs" / file
        with pymupdf.open(path) as pdf:
            flags = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES
            pages[file] = [p.get_text(flags=flags) for p in pdf]
        sources[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
        for bundle in sorted((ROOT / "ml/out/bundles" / stem).rglob("*.md")):
            sources[bundle.relative_to(ROOT).as_posix()] = gen.sha256(bundle)
    for q in selected:
        q["cohort"] = "previous_sentinel"
        if q["split"] != "train" or not q["answerable"] or any(compact(ref["quote"]) not in compact(pages[q["file"]][ref["page"]-1]) for ref in q["references"]):
            raise ValueError("Sentinel metadata or native evidence changed")
    rows = list(selected)
    for index, (file, question, name, page, span) in enumerate(FRESH, 1):
        if name:
            stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
            path = ROOT / "ml/out/bundles" / stem / "definitions" / (name + ".md")
            meta = yaml.safe_load(re.split(r"^---\s*$", path.read_text(encoding="utf-8"), maxsplit=2, flags=re.M)[1])
            page, quote = meta["margin"]["page"], meta["description"]
            if not any(s.get("title") == file for s in meta.get("sources", [])):
                raise ValueError("Fresh bundle source mismatch")
        else:
            quote = "\n".join(pages[file][page-1].splitlines()[span[0]:span[1]])
        if type(page) is not int or not 1 <= page <= len(pages[file]) or not compact(quote) or compact(quote) not in compact(pages[file][page-1]):
            raise ValueError("Fresh native reference mismatch")
        rows.append({"qid": f"B{index:03d}", "file": file, "group": manifest[file]["group"], "question": question,
                     "references": [{"page": page, "quote": quote}], "split": "train", "answerable": True, "cohort": "fresh_answerable"})
    for index, file in enumerate(files, 1):
        nonce = f"MARGINCOHERENCEPROBE20261018Z{index}"
        if nonce.casefold() in "\n".join(pages[file]).casefold():
            raise ValueError("Unsupported entity unexpectedly present in TRAIN source")
        rows.append({"qid": f"N{index:03d}", "file": file, "group": manifest[file]["group"],
                     "question": f"Which enrollment code does this document assign to the {nonce} archive?",
                     "references": [], "split": "train", "answerable": False, "cohort": "synthetic_unsupported"})
    if len(files) != 6 or len(rows) != 18 or sum(q["answerable"] for q in rows) != 12 or any(sum(q["file"] == f for q in rows) != 3 for f in files):
        raise ValueError("Need balanced eighteen-case/six-document screen")
    return rows, sources


def cached_contexts(study, previous):
    questions = {q["qid"]: q for q in study["questions"] if q["cohort"] == "previous_sentinel"}
    cached = {}
    prompt, _ = gen.prompt_modules()
    for record in previous["records"]:
        if record["method"] != "full_original" or record["qid"] not in questions:
            continue
        q, packet = questions[record["qid"]], record["packet"]
        if (record["qid"] in cached or record["set"] != "train" or record["file"] != q["file"] or
                packet["source_file"] != q["file"] or packet["question"] != q["question"] or
                packet["answerable"] != q["answerable"] or len(packet["contexts"]) > 8 or
                packet["answer_pages"] != sorted({ref["page"] for ref in q["references"]}) or
                packet["answer_quote"] != "\n\n".join(ref["quote"] for ref in q["references"]) or
                record["prompt"] != prompt.build_prompt(q["question"], packet["contexts"], mode="qa")):
            raise ValueError("Cached sentinel mismatch")
        cached[q["qid"]] = [{**c, "pdfFingerprint": q["file"]} for c in packet["contexts"]]
    if set(cached) != set(questions):
        raise ValueError("Incomplete sentinel context pools")
    return cached


def prepare(out=OUT):
    before = protected_hashes()
    previous = prior.load_plan()
    state = gen.read(prior.OUT / "generation_state.json")
    if state["status"] != "complete" or state["plan_sha256"] != gen.digest(previous):
        raise ValueError("Previous refinement must be complete")
    questions, sources = training_questions(previous)
    sources.update(previous["sources"])
    sources.update({p: gen.sha256(ROOT / p) for p in SOURCES})
    study = {"version": 1, "created_at": gen.now(), "questions": questions, "sources": sources,
             "protected": before, "model": previous["model"], "identity": previous["identity"],
             "server_identity": previous["server_identity"], "system": previous["system"], "options": OPTIONS,
             "variants": VARIANTS, "limitations": LIMITATIONS,
             "stopping_rule": "One bounded comparison; report accept-for-consideration or defer, no automatic further tuning or live change"}
    study["cached"] = cached_contexts(study, previous)
    if protected_hashes() != before:
        raise ValueError("Protected experiments changed in preparation")
    out.mkdir(parents=True, exist_ok=True)
    gen.write_new(out / "study.json", study)
    gen.write_new(out / "preparation.json", {"study_sha256": gen.sha256(out / "study.json")})
    return study


def load_study(out=OUT):
    study = gen.read(out / "study.json")
    if (gen.sha256(out / "study.json") != gen.read(out / "preparation.json")["study_sha256"]
            or study["options"] != OPTIONS or study["variants"] != VARIANTS or study["model"] != gen.MODEL
            or study["identity"] != gen.local_model_identity() or protected_hashes() != study["protected"]
            or any(gen.sha256(ROOT / p) != value for p, value in study["sources"].items())):
        raise ValueError("Coherence study, sources, model or protected experiments changed")
    validate_train({q["file"] for q in study["questions"]})
    return study


def build_plan(study, retrieve):
    prompt, _ = gen.prompt_modules()
    records, evidence = [], []
    questions = list(study["questions"])
    rng = random.Random(20261022)
    rng.shuffle(questions)
    for index, q in enumerate(questions):
        raw = retrieve(q)
        if (len(raw) > 8 or q["split"] != "train" or any((c.get("pdfFingerprint") or c.get("docId")) != q["file"]
                or (c.get("pdfFingerprint") and c.get("docId") and c["pdfFingerprint"] != c["docId"]) for c in raw)):
            raise ValueError("Need scoped TRAIN CE top-eight contexts")
        audit = {"qid": q["qid"], "answerable": q["answerable"], "raw": quality.reference_retention(q["references"], raw)}
        packets = {}
        for variant in VARIANTS:
            chosen = latency.bounded_contexts(raw, 8, 18000) if variant == "full" else select_contexts(q["question"], raw)
            if variant == "bounded" and (len(chosen) > 4 or sum(len(c["text"].encode()) for c in chosen) > 4000):
                raise ValueError("Coherent selection exceeds budget")
            safe = [{k: c[k] for k in ("text", "page", "kind", "type", "title", "verified") if k in c} for c in chosen]
            text = prompt.build_prompt(q["question"], safe, mode="qa")
            if len((study["system"] + text).encode()) + 1024 > OPTIONS["num_ctx"]:
                raise ValueError("Prompt exceeds conservative context allowance")
            packet = {"question": q["question"], "source_file": q["file"], "answerable": q["answerable"],
                      "answer_pages": sorted({ref["page"] for ref in q["references"]}),
                      "answer_quote": "\n\n".join(ref["quote"] for ref in q["references"]), "contexts": safe}
            packets[variant] = {"qid": q["qid"], "set": "train", "file": q["file"], "method": variant, "prompt": text, "packet": packet}
            audit[variant] = quality.reference_retention(q["references"], safe)
        for variant in (("full", "bounded") if index % 2 == 0 else ("bounded", "full")):
            records.append({"id": f"A{len(records)+1:03d}", **packets[variant]})
        evidence.append(audit)
    return {"version": 1, "model": study["model"], "model_digest": study["identity"]["digest"],
            "options": study["options"], "system": study["system"], "study_sha256": gen.digest(study),
            "records": records, "evidence": evidence}


def retrieve_plan(study):
    """CPU-heavy: fourteen fresh queries; reuse four exact sentinel pools."""
    import os
    os.environ.update(CUDA_VISIBLE_DEVICES="", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    import torch
    from sentence_transformers import CrossEncoder, SentenceTransformer
    torch.set_num_threads(3)
    service = str(ROOT / "local-llm/rag-api")
    if service not in sys.path:
        sys.path.append(service)
    import embedder
    import retriever
    import reranker
    from schemas import QueryScope
    from ml.eval.live_rag_eval import fill
    embedder.Embedder._instance = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu", local_files_only=True)
    reranker._cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu", local_files_only=True)
    files = sorted({q["file"] for q in study["questions"] if q["qid"] not in study["cached"]})
    fill(files, ROOT / "Test PDFs", ROOT / "ml/out/bundles", embedder.get_embeddings)

    def contexts(q):
        if q["qid"] in study["cached"]:
            return copy.deepcopy(study["cached"][q["qid"]])
        items = retriever.retrieve(q["question"], 24, QueryScope(docIds=[q["file"]]), "hybrid_concepts")
        return reranker.rerank(q["question"], items, 8, mode="cross_encoder")

    return build_plan(study, contexts)


def load_generation_plan(study, out):
    path = out / "plan.json"
    plan = gen.read(path)
    if (gen.sha256(path) != gen.read(out / "plan_seal.json")["plan_sha256"] or plan["study_sha256"] != gen.digest(study)
            or plan["options"] != study["options"] or plan["model"] != study["model"]
            or plan["model_digest"] != study["identity"]["digest"] or plan["system"] != study["system"]):
        raise ValueError("Sealed generation plan changed")
    return plan


def runtime_report(plan, answers):
    result = revision.runtime_report(plan, answers)
    result.update(variant_labels={"full": "full_original", "bounded": "coherent_original"}, limitations=LIMITATIONS)
    return result


def execute(study, out=OUT, report=RUNTIME_REPORT, retrieve=retrieve_plan, engine=None):
    if report.exists():
        raise FileExistsError("Coherence runtime exists; do not regenerate")
    if protected_hashes() != study["protected"]:
        raise ValueError("Protected experiments changed")
    engine = engine or quality.QualityOllama(study["server_identity"])
    if engine.identity() != study["server_identity"]:
        raise ValueError("Running model/version differs from sealed study")
    if not (out / "plan.json").exists():
        gen.write_new(out / "retrieval_started.json", {"study_sha256": gen.digest(study), "at": gen.now()})
        gen.write_new(out / "plan.json", retrieve(study))
        gen.write_new(out / "plan_seal.json", {"plan_sha256": gen.sha256(out / "plan.json")})
    plan = load_generation_plan(study, out)
    if protected_hashes() != study["protected"]:
        raise ValueError("Protected experiments changed during retrieval")
    state = gen.execute(plan, out, engine=engine)
    if state["status"] != "complete" or protected_hashes() != study["protected"]:
        raise ValueError("Incomplete generation or changed protected experiments")
    result = runtime_report(plan, gen.journal_answers(out / "answers.jsonl", plan["records"], gen.digest(plan)))
    result.update(plan_sha256=gen.digest(plan), journal_sha256=state["journal_sha256"], packet_sha256=state["packet_sha256"],
                  identity=state["identity"], recorded_at=gen.now())
    gen.write_new(report, result)
    return result


def score(packet, key, ratings, questions):
    judged = grading.validate_ratings(ratings, packet)
    qs, rows = {q["qid"]: q for q in questions}, {row["id"]: row for row in packet["records"]}
    for item, mapping in key["records"].items():
        q, row = qs.get(mapping["qid"]), rows.get(item)
        if (not q or not row or q["split"] != "train" or mapping["set"] != "train" or mapping["file"] != q["file"]
                or row["source_file"] != q["file"] or row["question"] != q["question"] or row["answerable"] != q["answerable"]):
            raise ValueError("Paired TRAIN question metadata mismatch")
    if {m["qid"] for m in key["records"].values()} != set(qs):
        raise ValueError("Incomplete question set")
    result = quality.score(packet, key, ratings)
    def subset(ids):
        subpacket = {"version": 1, "records": [row for row in packet["records"] if row["id"] in ids]}
        subpacket["packet_id"] = gen.digest(subpacket["records"])
        subkey = {"packet_id": subpacket["packet_id"], "records": {i: m for i, m in key["records"].items() if i in ids}}
        subratings = {**ratings, "packet_id": subpacket["packet_id"], "ratings": [row for row in ratings["ratings"] if row["id"] in ids]}
        output = quality.score(subpacket, subkey, subratings)
        output["limitations"] = LIMITATIONS
        return output

    result["cohorts"] = {cohort: subset({i for i, m in key["records"].items() if qs[m["qid"]]["cohort"] == cohort})
                         for cohort in sorted({q["cohort"] for q in questions})}
    result["answerability"] = {label: subset({i for i, m in key["records"].items() if qs[m["qid"]]["answerable"] == value})
                               for label, value in (("answerable", True), ("unsupported", False))
                               if any(q["answerable"] == value for q in questions)}
    result["correct_abstention"] = {}
    for method in VARIANTS:
        groups = defaultdict(list)
        for item, mapping in key["records"].items():
            if mapping["method"] == method and not qs[mapping["qid"]]["answerable"]:
                groups[mapping["file"]].append(int(judged[item]["correct_abstention"]))
        result["correct_abstention"][method] = document_bootstrap(groups) if groups else None
    result["unsupported_errors"] = sum(not judged[i]["correct_abstention"] for i, m in key["records"].items()
                                       if m["method"] == "bounded" and not qs[m["qid"]]["answerable"])
    result["limitations"] = LIMITATIONS
    return result


def score_review(ratings_path, out=OUT, runtime_path=RUNTIME_REPORT, report=QUALITY_REPORT):
    factorial.reject_frozen_path(ratings_path)
    if report.exists():
        raise FileExistsError("Coherence quality report already exists")
    state = gen.read(out / "generation_state.json")
    if (state["status"] != "complete" or state["packet_sha256"] != gen.sha256(out / "blind_packet.json")
            or state["key_sha256"] != gen.sha256(out / "private_key.json")):
        raise ValueError("Need complete generation and unchanged blind exports")
    packet, ratings = gen.read(out / "blind_packet.json"), gen.read(ratings_path)
    judged = grading.validate_ratings(ratings, packet)
    if packet["packet_id"] != gen.digest(packet["records"]):
        raise ValueError("Packet integrity mismatch")
    receipt = {"at": gen.now(), "ratings_count": len(judged), "ratings_sha256": gen.sha256(ratings_path),
               "packet_sha256": state["packet_sha256"], "key_sha256": state["key_sha256"],
               "rubric_sha256": gen.sha256(ROOT / "docs/ML5_GRADING.md"), "reviewer": "assistant", "human_validation": False,
               "methodology": "All ratings saved before grading-time study/plan/key disclosure; prior familiarity, partial blinding and shared authorship"}
    gen.write_new(out / "grading_receipt.json", receipt)
    study = load_study(out)
    plan = load_generation_plan(study, out)
    runtime = gen.read(runtime_path)
    if (state["plan_sha256"] != gen.digest(plan) or state["journal_sha256"] != gen.sha256(out / "answers.jsonl")
            or any(runtime[k] != state[k] for k in ("plan_sha256", "journal_sha256", "packet_sha256"))):
        raise ValueError("Completed plan/journal/runtime mismatch")
    result = score(packet, gen.read(out / "private_key.json"), ratings, study["questions"])
    losses = runtime["reference_questions_lost_by_smaller_budget"]
    blocked = losses or result["unsupported_errors"] or any(result["metrics"][metric]["regressions"] for metric in ("correctness", "grounding"))
    result.update(title="TRAIN same-page evidence coherence", grading=receipt, packet_id=packet["packet_id"],
                  additional_reference_losses=losses, decision="defer_coherent_selector" if blocked else "screen_passed_no_automatic_adoption",
                  stopping_rule=study["stopping_rule"], runtime_report_sha256=gen.sha256(runtime_path),
                  grading_receipt_sha256=gen.sha256(out / "grading_receipt.json"))
    gen.write_new(report, result)
    return result


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
        result = score_review(args.score)
        print(json.dumps(result, indent=2))
    elif args.prepare:
        study = prepare()
        print(f"Prepared {len(study['questions'])} TRAIN cases / six PDFs; 36 requests await approval. No model loaded.")
    elif args.check:
        load_study()
        print("Coherence study, sources and protected checkpoints match; no model loaded.")
    else:
        print(json.dumps(execute(load_study()), indent=2))


if __name__ == "__main__":
    main()
