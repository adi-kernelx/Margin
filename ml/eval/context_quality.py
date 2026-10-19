"""Small source-linked TRAIN quality screen; model work requires workload approval.

python -m ml.eval.context_quality --prepare
python -m ml.eval.context_quality --run
python -m ml.eval.context_quality --score path/to/human-ratings.json
"""

import argparse
import csv
import json
import random
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

from ml.eval import answer_generation as gen, answer_grading as grading, llm_latency as latency
from ml.eval.ml5_protocol import SOURCES as FROZEN_SOURCES
from ml.eval.stats import document_bootstrap
from ml.eval.validate_questions import compact, group_splits

ROOT = gen.ROOT
OUT = ROOT / "ml/out/context_quality"
RUNTIME_REPORT = ROOT / "ml/results/context_quality_train_runtime.json"
QUALITY_REPORT = ROOT / "ml/results/context_quality_train.json"
OPTIONS = {**gen.OPTIONS, "num_thread": 3}  # Retain the 512-token grading cap.
SIPSER = "Introduction to the theory of computation_third edition - Michael Sipser.pdf"
KKT = "KKT_Conditions_and_Constraint_Qualification__10th March 2026.pdf"
SPECS = (
    (SIPSER, ("alphabet",), "Which restrictions must a collection of symbols satisfy to count as an alphabet in this text?"),
    (SIPSER, ("alphabet", "language"), "How does this text distinguish an alphabet from a language?"),
    (KKT, ("regular-point",), "Under what condition is a point called regular in these optimization notes?"),
    (KKT, ("kuhn-tucker-conditions",), "Are Kuhn-Tucker conditions described here as necessary or sufficient conditions at a relative minimum?"),
    ("Decision_Trees_AI.pdf", ("coincidence",), "How can chance patterns lead a decision tree to overfit when a leaf contains very few examples?"),
    ("Decision_Trees_AI.pdf", ("small-structural-change",), "Can a continuous decision tree split on the same variable again along a path, and how does this differ from a categorical tree?"),
)
SOURCES = tuple(dict.fromkeys((*FROZEN_SOURCES, "ml/eval/context_quality.py", "ml/eval/answer_generation.py",
                              "ml/eval/answer_grading.py", "ml/eval/llm_latency.py", "ml/eval/grading.html")))


def protected_hashes():
    hashes = {f"ml/models/artifacts/ml5/grading/{name}": value for name, value in latency.checkpoint_hashes().items()}
    if (latency.OUT / "generation.lock").exists():
        raise ValueError("Latency workload must be stopped")
    for name in ("plan.json", "preparation.json", "answers.jsonl", "state.json"):
        path = latency.OUT / name
        hashes[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    hashes[latency.REPORT.relative_to(ROOT).as_posix()] = gen.sha256(latency.REPORT)
    return hashes


def training_questions():
    """Draft fresh questions; check TRAIN and exact native evidence before returning any."""
    import pymupdf
    import yaml
    splits = group_splits(gen.read(ROOT / "ml/splits.json"))
    manifest = {r["file"]: r for r in csv.DictReader((ROOT / "Test PDFs/manifest.csv").open(encoding="utf-8"))}
    train_files = set(gen.read(ROOT / "ml/models/artifacts/ml5/protocol.json")["train_files"])
    files = sorted({s[0] for s in SPECS})
    if any(f not in train_files or f not in manifest or splits.get(manifest[f]["group"]) != "train"
           or Path(f).name != f for f in files):
        raise ValueError("Every quality source must be in frozen TRAIN groups")
    sources, pages, rows = {}, {}, []
    for file in files:
        path = ROOT / "Test PDFs" / file
        with pymupdf.open(path) as document:
            # Expand typographic ligatures; retain case, punctuation and math symbols.
            flags = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES
            pages[file] = [page.get_text(flags=flags) for page in document]
        sources[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
        for path in sorted((ROOT / "ml/out/bundles" / stem).rglob("*.md")):
            sources[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
    for index, (file, names, question) in enumerate(SPECS, 1):
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
        references = []
        for name in names:
            path = ROOT / "ml/out/bundles" / stem / "definitions" / (name + ".md")
            markdown = path.read_text(encoding="utf-8")
            meta = yaml.safe_load(re.split(r"^---\s*$", markdown, maxsplit=2, flags=re.M)[1])
            page, quote = meta["margin"]["page"], meta["description"]
            if (type(page) is not int or not 1 <= page <= len(pages[file]) or not compact(quote)
                    or compact(quote) not in compact(pages[file][page-1])
                    or not any(s.get("title") == file for s in meta.get("sources", []))):
                raise ValueError(f"Draft reference must match its native TRAIN PDF page and source: {file}, {name}, page {page}")
            references.append({"page": page, "quote": quote})
        rows.append({"qid": f"Q{index:03d}", "file": file, "group": manifest[file]["group"],
                     "question": question, "references": references, "split": "train", "answerable": True})
    return rows, sources


def prepare(out=OUT):
    protected = protected_hashes()
    questions, sources = training_questions()
    if len(questions) != 6 or len({q["file"] for q in questions}) != 3:
        raise ValueError("This screen fixes six questions over three TRAIN documents")
    sources.update({name: gen.sha256(ROOT / name) for name in SOURCES})
    _, llm = gen.prompt_modules()
    study = {"version": 1, "created_at": gen.now(), "questions": questions, "sources": sources,
             "protected": protected, "model": gen.MODEL, "identity": gen.local_model_identity(),
             "server_identity": gen.read(latency.REPORT)["identity"],
             "options": OPTIONS, "system": llm.SYSTEM, "variants": latency.VARIANTS,
             "retrieval": {"method": "hybrid_concepts", "reranker": "cross_encoder", "candidates": 24, "top_k": 8},
             "selection": "Six fresh AI-authored, answerable source-linked TRAIN questions; small diagnostic screen"}
    if protected_hashes() != protected:
        raise ValueError("Protected experiments changed during preparation")
    out.mkdir(parents=True, exist_ok=True)
    gen.write_new(out / "study.json", study)
    gen.write_new(out / "preparation.json", {"study_sha256": gen.sha256(out / "study.json")})
    return study


def load_study(out=OUT):
    study = gen.read(out / "study.json")
    if (gen.sha256(out / "study.json") != gen.read(out / "preparation.json")["study_sha256"]
            or study["options"] != OPTIONS or study["variants"] != latency.VARIANTS
            or study["identity"] != gen.local_model_identity() or study["model"] != gen.MODEL
            or any(gen.sha256(ROOT / name) != value for name, value in study["sources"].items())
            or protected_hashes() != study["protected"]):
        raise ValueError("Quality study, sources, model or protected experiments changed")
    return study


def reference_retention(references, contexts):
    return [any(compact(ref["quote"]) in compact(c["text"]) for c in contexts) for ref in references]


def build_plan(study, retrieve_contexts, build_prompt):
    records, evidence = [], []
    for q in study["questions"]:
        raw = retrieve_contexts(q)
        if len(raw) > 8 or any((c.get("pdfFingerprint") or c.get("docId")) != q["file"] for c in raw):
            raise ValueError("Need at most eight contexts scoped to the question's TRAIN PDF")
        audit = {"qid": q["qid"], "raw": reference_retention(q["references"], raw)}
        for variant, budget in study["variants"].items():
            packed = latency.bounded_contexts(raw, budget["contexts"], budget["bytes"])
            safe = [{k: c[k] for k in ("text", "page", "kind", "type", "title", "verified") if k in c} for c in packed]
            prompt = build_prompt(q["question"], packed, mode="qa")
            if len((study["system"] + prompt).encode("utf-8")) + 1024 > study["options"]["num_ctx"]:
                raise ValueError("Quality prompt exceeds the conservative context allowance")
            audit[variant] = reference_retention(q["references"], packed)
            packet = {"question": q["question"], "source_file": q["file"], "answerable": True,
                      "answer_pages": sorted({r["page"] for r in q["references"]}),
                      "answer_quote": "\n\n".join(r["quote"] for r in q["references"]), "contexts": safe}
            records.append({"qid": q["qid"], "set": "train", "file": q["file"], "method": variant,
                            "prompt": prompt, "packet": packet})
        evidence.append(audit)
    random.Random(20261018).shuffle(records)
    for index, record in enumerate(records, 1):
        record["id"] = f"A{index:03d}"
    return {"version": 1, "model": study["model"], "model_digest": study["identity"]["digest"],
            "options": study["options"], "system": study["system"], "study_sha256": gen.digest(study),
            "records": records, "evidence": evidence}


def retrieve_plan(study):
    """CPU-heavy stage: load cached CPU models only after explicit workload approval."""
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
    embedder.Embedder._instance = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu", local_files_only=True)
    reranker._cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu", local_files_only=True)
    files = sorted({q["file"] for q in study["questions"]})
    fill(files, ROOT / "Test PDFs", ROOT / "ml/out/bundles", embedder.get_embeddings)
    prompt, _ = gen.prompt_modules()

    def contexts(q):
        candidates = retriever.retrieve(q["question"], 24, QueryScope(docIds=[q["file"]]), "hybrid_concepts")
        return reranker.rerank(q["question"], candidates, 8, mode="cross_encoder")

    return build_plan(study, contexts, prompt.build_prompt)


class QualityOllama(latency.StreamingOllama):
    def __init__(self, expected, client=None):
        super().__init__(client)
        self.expected = expected

    def identity(self):
        identity = super().identity()
        if identity != self.expected:
            raise ValueError("Ollama model/version differs from the sealed study")
        return identity

    def answer(self, plan, record):
        return self.measure(plan, record)


def runtime_report(plan, answers):
    evidence = plan["evidence"]
    samples = []
    for record in plan["records"]:
        event = answers[record["id"]]
        m = event["metrics"]
        samples.append({"variant": record["method"], "first_text_seconds": event["first_text_seconds"],
                        "wall_seconds": event["wall_seconds"], "prompt_seconds": m["prompt_eval_duration"]/1e9,
                        "output_seconds": m["eval_duration"]/1e9, "prompt_tokens": m["prompt_eval_count"],
                        "output_tokens": m["eval_count"], "done_reason": event["done_reason"]})
    fields = ("first_text_seconds", "wall_seconds", "prompt_seconds", "output_seconds", "prompt_tokens", "output_tokens")
    timing = {v: {"requests": sum(s["variant"] == v for s in samples),
                   "means": {k: statistics.mean(s[k] for s in samples if s["variant"] == v) for k in fields},
                   "length_stops": sum(s["variant"] == v and s["done_reason"] == "length" for s in samples)}
              for v in ("full", "bounded")}
    return {"status": "generation_complete_grading_pending", "questions": len(evidence),
            "documents": len({r['file'] for r in plan['records']}),
            "answers": len(samples), "options": plan["options"], "timing": timing,
            "complete_reference_questions": {v: sum(all(e[v]) for e in evidence) for v in ("raw", "full", "bounded")},
            "reference_questions_lost_by_large_budget": sum(all(e["raw"]) and not all(e["full"]) for e in evidence),
            "reference_questions_lost_by_smaller_budget": sum(all(e["full"]) and not all(e["bounded"]) for e in evidence),
            "quality_assessed": False, "live_defaults_changed": False,
            "limitations": "Six answerable AI-authored TRAIN questions over three PDFs; exact individual-quote retention is a conservative evidence proxy, not semantic answer correctness. No negatives, representative traffic, independent authorship or default-switch claim. Cache/order and output lengths affect timing."}


def execute(study, out=OUT, report=RUNTIME_REPORT, retrieve=retrieve_plan, engine=None):
    if report.exists():
        raise FileExistsError("Runtime report exists; do not regenerate")
    if protected_hashes() != study["protected"]:
        raise ValueError("Protected experiments changed")
    engine = engine or QualityOllama(study["server_identity"])
    if engine.identity() != study["server_identity"]:
        raise ValueError("Running model/version differs from the sealed study")
    path = out / "plan.json"
    if not path.exists():
        # An interrupted retrieval build needs diagnosis, not an automatic CPU rerun.
        gen.write_new(out / "retrieval_started.json", {"study_sha256": gen.digest(study), "at": gen.now()})
        plan = retrieve(study)
        gen.write_new(path, plan)
        gen.write_new(out / "plan_seal.json", {"plan_sha256": gen.sha256(path)})
    plan = gen.read(path)
    if (gen.sha256(path) != gen.read(out / "plan_seal.json")["plan_sha256"]
            or plan["study_sha256"] != gen.digest(study) or plan["options"] != study["options"]):
        raise ValueError("Prepared retrieval plan changed")
    if protected_hashes() != study["protected"]:
        raise ValueError("Protected experiments changed during retrieval")
    state = gen.execute(plan, out, engine=engine)
    if state["status"] != "complete" or protected_hashes() != study["protected"]:
        raise ValueError("Incomplete generation or changed protected experiments")
    answers = gen.journal_answers(out / "answers.jsonl", plan["records"], gen.digest(plan))
    output = runtime_report(plan, answers)
    output.update(plan_sha256=gen.digest(plan), journal_sha256=state["journal_sha256"],
                  packet_sha256=state["packet_sha256"], identity=state["identity"], recorded_at=gen.now())
    report.parent.mkdir(parents=True, exist_ok=True)
    gen.write_new(report, output)
    return output


def score(packet, key, ratings):
    if packet["packet_id"] != gen.digest(packet["records"]) or key["packet_id"] != packet["packet_id"]:
        raise ValueError("Packet/key integrity mismatch")
    judged = grading.validate_ratings(ratings, packet)
    if set(judged) != set(key["records"]):
        raise ValueError("Private key does not cover the packet")
    pairs = {}
    for item, mapping in key["records"].items():
        pair = pairs.setdefault(mapping["qid"], {"file": mapping["file"]})
        method = mapping["method"]
        if method not in {"full", "bounded"} or method in pair or pair["file"] != mapping["file"] or mapping["set"] != "train":
            raise ValueError("Need one TRAIN answer per budget and question")
        pair[method] = judged[item]
    if any(set(p) != {"file", "full", "bounded"} for p in pairs.values()):
        raise ValueError("Incomplete budget pair")
    output = {"questions": len(pairs), "documents": len({p["file"] for p in pairs.values()}), "metrics": {},
              "quality_assessed": True, "live_defaults_changed": False,
              "limitations": "Small AI-authored answerable TRAIN screen; single grader, only three document clusters. Bootstrap intervals are exploratory; no noninferiority or production-default claim."}
    for metric in ("correctness", "grounding"):
        values = {}
        for method in ("full", "bounded", "bounded_minus_full"):
            groups = defaultdict(list)
            for pair in pairs.values():
                value = (pair["bounded"][metric] - pair["full"][metric]) if method == "bounded_minus_full" else pair[method][metric]
                groups[pair["file"]].append(value)
            values[method] = document_bootstrap(groups)
        values["regressions"] = sum(p["bounded"][metric] < p["full"][metric] for p in pairs.values())
        output["metrics"][metric] = values
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
        parser.error("Frozen question files cannot be used as ratings")
    if args.prepare:
        study = prepare()
        print(f"Prepared {len(study['questions'])} native-verified TRAIN questions; no model loaded")
    elif args.check:
        load_study()
        print("Quality study and protected experiments match; no model loaded")
    elif args.run:
        output = execute(load_study())
        print(json.dumps({k: v for k, v in output.items() if k != "samples"}, indent=2))
    else:
        load_study()
        if QUALITY_REPORT.exists():
            raise FileExistsError("Quality report already exists")
        state = gen.read(OUT / "generation_state.json")
        if (state["status"] != "complete" or state["packet_sha256"] != gen.sha256(OUT / "blind_packet.json")
                or state["key_sha256"] != gen.sha256(OUT / "private_key.json")):
            raise ValueError("Complete generation and matching packet/key required")
        ratings = gen.read(args.score)
        output = score(gen.read(OUT / "blind_packet.json"), gen.read(OUT / "private_key.json"), ratings)
        output.update(packet_id=ratings["packet_id"], ratings_sha256=gen.sha256(args.score))
        gen.write_new(QUALITY_REPORT, output)
        print("Saved aggregate TRAIN quality screen; no model loaded")


if __name__ == "__main__":
    main()
