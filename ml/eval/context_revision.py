"""Separate TRAIN packing/prompt revision; --run requires workload approval."""

import argparse
import csv
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

from ml.eval import answer_generation as gen, answer_grading as grading
from ml.eval import context_quality as quality, grounded_prompt, llm_latency as latency
from ml.eval.stats import document_bootstrap
from ml.eval.validate_questions import compact, group_splits
from ml.retrieval.context_packing import select_contexts

ROOT = gen.ROOT
OUT = ROOT / "ml/out/context_revision"
RUNTIME_REPORT = ROOT / "ml/results/context_revision_train_runtime.json"
QUALITY_REPORT = ROOT / "ml/results/context_revision_train.json"
OPTIONS = {**gen.OPTIONS, "num_thread": 3}
VARIANTS = {"full": {"contexts": 8, "bytes": 18000, "prompt": "original"},
            "bounded": {"contexts": 6, "bytes": 4000, "prompt": "grounded"}}
CLASSIFICATION = "Lec Classification PDF.pdf"
NONCES = ("MARGINTRAINPROBEK7Z20261018", "MARGINTRAINPROBEF9V20261018")
NEW_SPECS = (
    (quality.SIPSER, "empty-string", "What is the length of the empty string, and which symbol denotes it in this text?"),
    (CLASSIFICATION, "decision-boundary", "What separates neighboring class regions, and why are the decision boundaries shown parallel to the axes?"),
    (quality.KKT, None, f"On what calendar date do these notes say the {NONCES[0]} deployment was launched?"),
    (CLASSIFICATION, None, f"What access code does this lecture assign to the {NONCES[1]} archive?")
)
SOURCES = tuple(dict.fromkeys((*quality.SOURCES, "ml/eval/context_revision.py", "ml/eval/grounded_prompt.py",
                              "ml/retrieval/context_packing.py", "docs/ML5_CONTEXT_REVISION.md")))
LIMITATIONS = ("Development screen: six previously reviewed TRAIN cases plus four new assistant-authored probes "
               "(two answerable, two synthetic unsupported) over four TRAIN PDFs. Packing and prompting change together. "
               "Assistant review, partial blinding and shared authorship limit independence. Document-bootstrap intervals "
               "are exploratory with few clusters; no population, production latency or default-switch claim. "
               "Citation syntax checks do not prove semantic support. Cache/order and output length affect timing.")


def protected_hashes():
    hashes = quality.protected_hashes()
    if (quality.OUT / "generation.lock").exists():
        raise ValueError("Previous quality experiment must be stopped")
    for name in ("study.json", "preparation.json", "plan.json", "plan_seal.json", "answers.jsonl",
                 "generation_state.json", "blind_packet.json", "private_key.json", "ratings.assistant.json", "grading_receipt.json"):
        path = quality.OUT / name
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    for path in (quality.RUNTIME_REPORT, quality.QUALITY_REPORT):
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    return hashes


def fresh_questions():
    """Native-reference checks are model-free; reject non-TRAIN before PDF access."""
    import pymupdf
    import yaml
    splits = group_splits(gen.read(ROOT / "ml/splits.json"))
    with (ROOT / "Test PDFs/manifest.csv").open(encoding="utf-8") as source:
        manifest = {r["file"]: r for r in csv.DictReader(source)}
    train = set(gen.read(ROOT / "ml/models/artifacts/ml5/protocol.json")["train_files"])
    files = sorted({s[0] for s in NEW_SPECS})
    if any(Path(f).name != f or f not in train or f not in manifest or splits.get(manifest[f]["group"]) != "train" for f in files):
        raise ValueError("Fresh probes must use frozen TRAIN groups")
    pages, sources = {}, {}
    for file in files:
        path = ROOT / "Test PDFs" / file
        with pymupdf.open(path) as pdf:
            flags = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES
            pages[file] = [p.get_text(flags=flags) for p in pdf]
        sources[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
        for bundle in sorted((ROOT / "ml/out/bundles" / stem).rglob("*.md")):
            sources[bundle.relative_to(ROOT).as_posix()] = gen.sha256(bundle)
    rows = []
    for index, (file, concept, question) in enumerate(NEW_SPECS, 7):
        references = []
        if concept:
            stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
            path = ROOT / "ml/out/bundles" / stem / "definitions" / (concept + ".md")
            markdown = path.read_text(encoding="utf-8")
            meta = yaml.safe_load(re.split(r"^---\s*$", markdown, maxsplit=2, flags=re.M)[1])
            quotes = re.findall(r"^> (.+)$", markdown, flags=re.M)
            page = meta["margin"]["page"]
            # Slide blockquotes can prepend plotted tick labels in a different
            # extraction order. Use each bullet's literal claim, not the ticks.
            claims = quotes[0].split("•")[1:] if len(quotes) == 1 and "•" in quotes[0] else quotes
            if (len(quotes) != 1 or not claims or type(page) is not int or not 1 <= page <= len(pages[file])
                    or any(not compact(quote) or compact(quote) not in compact(pages[file][page-1]) for quote in claims)
                    or not any(s.get("title") == file for s in meta.get("sources", []))):
                raise ValueError("Fresh evidence must match its native TRAIN page and source")
            references = [{"page": page, "quote": quote.strip()} for quote in claims]
        else:
            nonce = NONCES[index - 9]
            if nonce not in question or nonce.casefold() in "\n".join(pages[file]).casefold():
                raise ValueError("Synthetic unsupported entity must be absent from its TRAIN source")
        rows.append({"qid": f"Q{index:03d}", "file": file, "question": question, "group": manifest[file]["group"],
                     "split": "train", "answerable": bool(concept), "references": references,
                     "cohort": "new_answerable" if concept else "synthetic_unsupported"})
    return rows, sources


def cached_contexts(study):
    """Only the completed TRAIN plan; neither frozen question source is opened."""
    plan = gen.read(quality.OUT / "plan.json")
    if gen.sha256(quality.OUT / "plan.json") != gen.read(quality.OUT / "plan_seal.json")["plan_sha256"]:
        raise ValueError("Prior TRAIN plan seal changed")
    cached = {}
    questions = {q["qid"]: q for q in study["questions"] if q["cohort"] == "previous_development"}
    for record in plan["records"]:
        if record["method"] != "full":
            continue
        q = questions.get(record["qid"])
        if (not q or record["qid"] in cached or record["set"] != "train" or record["file"] != q["file"]
                or record["packet"]["question"] != q["question"]):
            raise ValueError("Prior TRAIN context/question mismatch")
        contexts = record["packet"]["contexts"]
        # Prior full cap was not reached; these are the original entire CE top-8 pools.
        if len(contexts) > 8 or sum(len(c["text"].encode("utf-8")) for c in contexts) >= 18000:
            raise ValueError("Prior top-eight contexts may have been clipped")
        cached[q["qid"]] = [{**c, "pdfFingerprint": q["file"]} for c in contexts]
    if set(cached) != set(questions):
        raise ValueError("Incomplete cached TRAIN context pool")
    return cached


def prepare(out=OUT):
    before = protected_hashes()
    previous = quality.load_study()
    fresh, sources = fresh_questions()
    questions = [{**q, "cohort": "previous_development"} for q in previous["questions"]] + fresh
    if len(questions) != 10 or len({q["file"] for q in questions}) != 4 or sum(q["answerable"] for q in questions) != 8:
        raise ValueError("Revision fixes ten questions, eight answerable, over four TRAIN PDFs")
    sources.update(previous["sources"])
    sources.update({name: gen.sha256(ROOT / name) for name in SOURCES})
    study = {"version": 1, "created_at": gen.now(), "questions": questions, "sources": sources,
             "protected": before, "model": previous["model"], "identity": previous["identity"],
             "server_identity": previous["server_identity"], "system": previous["system"],
             "options": OPTIONS, "variants": VARIANTS, "limitations": LIMITATIONS,
             "decision_rule": "Any paired correctness/grounding regression, extra evidence loss, or unsupported answer blocks consideration; no automatic adoption"}
    cached_contexts(study)
    if protected_hashes() != before:
        raise ValueError("Protected experiments changed during preparation")
    out.mkdir(parents=True, exist_ok=True)
    gen.write_new(out / "study.json", study)
    gen.write_new(out / "preparation.json", {"study_sha256": gen.sha256(out / "study.json")})
    return study


def load_study(out=OUT):
    study = gen.read(out / "study.json")
    if (gen.sha256(out / "study.json") != gen.read(out / "preparation.json")["study_sha256"]
            or study["options"] != OPTIONS or study["variants"] != VARIANTS
            or study["model"] != gen.MODEL or study["identity"] != gen.local_model_identity()
            or any(gen.sha256(ROOT / name) != value for name, value in study["sources"].items())
            or protected_hashes() != study["protected"]):
        raise ValueError("Revision study, sources, model or protected experiments changed")
    return study


def build_plan(study, retrieve_contexts):
    original_prompt, _ = gen.prompt_modules()
    records, evidence = [], []
    for q in study["questions"]:
        raw = retrieve_contexts(q)
        if len(raw) > 8 or any((c.get("pdfFingerprint") or c.get("docId")) != q["file"] for c in raw):
            raise ValueError("Need scoped TRAIN top-eight contexts")
        audit = {"qid": q["qid"], "answerable": q["answerable"], "raw": quality.reference_retention(q["references"], raw)}
        for variant in ("full", "bounded"):
            packed = latency.bounded_contexts(raw, 8, 18000) if variant == "full" else select_contexts(q["question"], raw)
            prompt = (original_prompt.build_prompt(q["question"], packed, mode="qa") if variant == "full"
                      else grounded_prompt.build_prompt(q["question"], packed))
            if len((study["system"] + prompt).encode("utf-8")) + 1024 > study["options"]["num_ctx"]:
                raise ValueError("Revision prompt exceeds conservative context allowance")
            safe = [{k: c[k] for k in ("text", "page", "kind", "type", "title", "verified") if k in c} for c in packed]
            audit[variant] = quality.reference_retention(q["references"], safe)
            packet = {"question": q["question"], "source_file": q["file"], "answerable": q["answerable"],
                      "answer_pages": sorted({r["page"] for r in q["references"]}),
                      "answer_quote": "\n\n".join(r["quote"] for r in q["references"]), "contexts": safe}
            records.append({"qid": q["qid"], "set": "train", "file": q["file"], "method": variant,
                            "prompt": prompt, "packet": packet})
        evidence.append(audit)
    random.Random(20261019).shuffle(records)
    for i, record in enumerate(records, 1):
        record["id"] = f"A{i:03d}"
    return {"version": 1, "model": study["model"], "model_digest": study["identity"]["digest"],
            "options": study["options"], "system": study["system"], "study_sha256": gen.digest(study),
            "records": records, "evidence": evidence}


def retrieve_plan(study):
    """Approval required: only four new queries need encoder/CE work."""
    import os
    os.environ.update(CUDA_VISIBLE_DEVICES="", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    import torch
    from sentence_transformers import CrossEncoder, SentenceTransformer
    torch.set_num_threads(3)
    sys.path.append(str(ROOT / "local-llm/rag-api"))
    import embedder
    import retriever
    import reranker
    from schemas import QueryScope
    from ml.eval.live_rag_eval import fill
    cached = cached_contexts(study)
    embedder.Embedder._instance = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu", local_files_only=True)
    reranker._cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu", local_files_only=True)
    files = sorted({q["file"] for q in study["questions"] if q["qid"] not in cached})
    fill(files, ROOT / "Test PDFs", ROOT / "ml/out/bundles", embedder.get_embeddings)

    def contexts(q):
        if q["qid"] in cached:
            return cached[q["qid"]]
        candidates = retriever.retrieve(q["question"], 24, QueryScope(docIds=[q["file"]]), "hybrid_concepts")
        return reranker.rerank(q["question"], candidates, 8, mode="cross_encoder")

    return build_plan(study, contexts)


def runtime_report(plan, answers):
    output = quality.runtime_report(plan, answers)
    answerable = [e for e in plan["evidence"] if e["answerable"]]
    output.update(answerable_questions=len(answerable), unsupported_probes=len(plan["evidence"]) - len(answerable),
                  complete_reference_questions={v: sum(all(e[v]) for e in answerable) for v in ("raw", "full", "bounded")},
                  reference_questions_lost_by_large_budget=sum(all(e["raw"]) and not all(e["full"]) for e in answerable),
                  reference_questions_lost_by_smaller_budget=sum(all(e["full"]) and not all(e["bounded"]) for e in answerable),
                  variant_labels={"full": "larger_original_prompt", "bounded": "selected_grounded_prompt"}, limitations=LIMITATIONS)
    audits = defaultdict(list)
    for r in plan["records"]:
        audits[r["method"]].append(grounded_prompt.citation_audit(answers[r["id"]]["answer"], len(r["packet"]["contexts"])))
    output["citation_syntax"] = {v: {"invalid_mentions": sum(a["invalid_mentions"] for a in values),
                                       "answers_without_citation": sum(a["no_citation"] for a in values),
                                       "semantic_support_assessed": False} for v, values in audits.items()}
    return output


def execute(study, out=OUT, report=RUNTIME_REPORT, retrieve=retrieve_plan, engine=None):
    if report.exists():
        raise FileExistsError("Revision runtime report exists; do not regenerate")
    if protected_hashes() != study["protected"]:
        raise ValueError("Protected experiments changed")
    engine = engine or quality.QualityOllama(study["server_identity"])
    if engine.identity() != study["server_identity"]:
        raise ValueError("Running model/version differs from sealed study")
    path = out / "plan.json"
    if not path.exists():
        gen.write_new(out / "retrieval_started.json", {"study_sha256": gen.digest(study), "at": gen.now()})
        gen.write_new(path, retrieve(study))
        gen.write_new(out / "plan_seal.json", {"plan_sha256": gen.sha256(path)})
    plan = gen.read(path)
    if (gen.sha256(path) != gen.read(out / "plan_seal.json")["plan_sha256"]
            or plan["study_sha256"] != gen.digest(study) or plan["options"] != study["options"]):
        raise ValueError("Revision plan changed")
    if protected_hashes() != study["protected"]:
        raise ValueError("Protected experiments changed during retrieval")
    state = gen.execute(plan, out, engine=engine)
    if state["status"] != "complete" or protected_hashes() != study["protected"]:
        raise ValueError("Incomplete generation or changed protected experiments")
    answers = gen.journal_answers(out / "answers.jsonl", plan["records"], gen.digest(plan))
    output = runtime_report(plan, answers)
    output.update(plan_sha256=gen.digest(plan), journal_sha256=state["journal_sha256"],
                  packet_sha256=state["packet_sha256"], identity=state["identity"], recorded_at=gen.now())
    gen.write_new(report, output)
    return output


def score_review(ratings_path, out=OUT, report=QUALITY_REPORT):
    """Seal complete delegated ratings before accessing the method key."""
    if report.exists():
        raise FileExistsError("Revision quality report exists")
    study = load_study(out)
    state = gen.read(out / "generation_state.json")
    if (state["status"] != "complete" or state["packet_sha256"] != gen.sha256(out / "blind_packet.json")
            or state["key_sha256"] != gen.sha256(out / "private_key.json")):
        raise ValueError("Need complete generation with unchanged blind exports")
    packet, ratings = gen.read(out / "blind_packet.json"), gen.read(ratings_path)
    judged = grading.validate_ratings(ratings, packet)
    receipt = {"ratings_sha256": gen.sha256(ratings_path), "packet_sha256": state["packet_sha256"],
               "key_sha256": state["key_sha256"], "reviewer": "assistant", "human_validation": False,
               "methodology": "Complete ratings saved before method-key access; partial blinding, prior-case familiarity and shared question authorship", "at": gen.now()}
    gen.write_new(out / "grading_receipt.json", receipt)
    key = gen.read(out / "private_key.json")
    output = quality.score(packet, key, ratings)
    questions = {q["qid"]: q for q in study["questions"]}
    cohorts = {}
    for cohort in ("previous_development", "new_answerable", "synthetic_unsupported"):
        ids = {item for item, mapping in key["records"].items() if questions[mapping["qid"]]["cohort"] == cohort}
        subpacket = {"version": 1, "records": [r for r in packet["records"] if r["id"] in ids]}
        subpacket["packet_id"] = gen.digest(subpacket["records"])
        subkey = {"packet_id": subpacket["packet_id"], "records": {i: r for i, r in key["records"].items() if i in ids}}
        subratings = {**ratings, "packet_id": subpacket["packet_id"], "ratings": [r for r in ratings["ratings"] if r["id"] in ids]}
        cohorts[cohort] = quality.score(subpacket, subkey, subratings)
    abstention = {}
    for method in ("full", "bounded"):
        groups = defaultdict(list)
        for item, mapping in key["records"].items():
            if mapping["method"] == method and not questions[mapping["qid"]]["answerable"]:
                groups[mapping["file"]].append(int(judged[item]["correct_abstention"]))
        abstention[method] = document_bootstrap(groups)
    runtime = gen.read(RUNTIME_REPORT)
    if any(runtime[k] != state[k] for k in ("plan_sha256", "journal_sha256", "packet_sha256")):
        raise ValueError("Runtime report differs from completed generation")
    regressions = any(output["metrics"][m]["regressions"] for m in ("correctness", "grounding"))
    negative_errors = any(not judged[i]["correct_abstention"] for i, m in key["records"].items()
                          if m["method"] == "bounded" and not questions[m["qid"]]["answerable"])
    blocked = regressions or negative_errors or runtime["reference_questions_lost_by_smaller_budget"] > 0
    output.update(title="TRAIN context selection and citation comparison", limitations=LIMITATIONS,
                  cohorts=cohorts, correct_abstention=abstention, grading=receipt,
                  packet_id=packet["packet_id"], ratings_sha256=receipt["ratings_sha256"],
                  decision="hold_revision" if blocked else "screen_passed_further_validation_required",
                  variant_labels=runtime["variant_labels"])
    for result in cohorts.values():
        result["limitations"] = LIMITATIONS
    gen.write_new(report, output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--run", action="store_true")
    mode.add_argument("--score", type=Path, metavar="RATINGS")
    args = parser.parse_args()
    if args.score and args.score.resolve() in {ROOT / "ml/eval/questions.jsonl", ROOT / "ml/eval/questions_independent.jsonl"}:
        parser.error("Frozen questions cannot be ratings")
    if args.prepare:
        print(f"Prepared {len(prepare()['questions'])} TRAIN questions; no model loaded")
    elif args.check:
        load_study()
        print("Revision sources/model/protected experiments match; no model loaded")
    elif args.run:
        print(json.dumps(execute(load_study()), indent=2))
    else:
        print(json.dumps(score_review(args.score), indent=2))


if __name__ == "__main__":
    main()
