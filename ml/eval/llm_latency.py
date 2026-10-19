"""Separate TRAIN-only latency probe; never reads question sets or changes live defaults.

python -m ml.eval.llm_latency --prepare
python -m ml.eval.llm_latency --run
"""

import argparse
import csv
import importlib
import json
import re
import statistics
import sys
import time
from pathlib import Path

from ml.eval import answer_generation as gen

ROOT = gen.ROOT
OUT = ROOT / "ml/out/llm_latency"
REPORT = ROOT / "ml/results/llm_latency_train.json"
OPTIONS = {**gen.OPTIONS, "num_thread": 3, "num_predict": 128}
VARIANTS = {"full": {"contexts": 8, "bytes": 18000}, "bounded": {"contexts": 3, "bytes": 4000}}
SOURCES = ("ml/eval/llm_latency.py", "ml/eval/answer_generation.py", "local-llm/rag-api/prompt.py",
           "local-llm/rag-api/llm_client.py", "local-llm/rag-api/concepts_api.py",
           "ml/splits.json", "Test PDFs/manifest.csv", "ml/models/artifacts/ml5/protocol.json")
CHECKPOINTS = ("plan.json", "preparation.json", "answers.jsonl", "generation_state.json", "runtime_amendment.json")
METRICS = ("total_duration", "load_duration", "prompt_eval_count", "prompt_eval_duration", "eval_count", "eval_duration")


def checkpoint_hashes():
    if (gen.OUT / "generation.lock").exists():
        raise ValueError("The grading generation workload must be paused")
    return {name: gen.sha256(gen.OUT / name) for name in CHECKPOINTS}


def bounded_contexts(contexts, count, byte_budget):
    """Retain whole words where possible; the explicit budget measures UTF-8 text bytes."""
    selected = []
    for context in contexts[:count]:
        remaining = byte_budget - sum(len(c["text"].encode("utf-8")) for c in selected)
        if remaining <= 0:
            break
        raw = context["text"].encode("utf-8")
        text = raw[:remaining].decode("utf-8", errors="ignore")
        if len(raw) > remaining and " " in text:
            text = text.rsplit(" ", 1)[0]
        if text.strip():
            selected.append({**context, "text": text})
    return selected


def make_records(cases, build_prompt):
    records = []
    for index, case in enumerate(cases):
        # Reverse the second pair to make cache/order limitations visible.
        for variant in (("full", "bounded") if index % 2 == 0 else ("bounded", "full")):
            budget = VARIANTS[variant]
            contexts = bounded_contexts(case["contexts"], budget["contexts"], budget["bytes"])
            question = "Explain the main definitions and claims in these document excerpts. Cite the sources."
            prompt = build_prompt(question, contexts, mode="qa")
            records.append({"id": f"L{len(records)+1:03d}", "case": f"C{index+1:02d}", "variant": variant,
                            "file": case["file"], "prompt": prompt, "contexts": len(contexts),
                            "context_bytes": sum(len(c["text"].encode("utf-8")) for c in contexts)})
    return records


def training_cases():
    """Select two long-context stress cases, validating TRAIN before reading bundle text."""
    import yaml
    from ml.eval.validate_questions import group_splits
    splits = group_splits(gen.read(ROOT / "ml/splits.json"))
    manifest = {r["file"]: r for r in csv.DictReader((ROOT / "Test PDFs/manifest.csv").open(encoding="utf-8"))}
    files = gen.read(ROOT / "ml/models/artifacts/ml5/protocol.json")["train_files"]
    if not files or any(f not in manifest or splits.get(manifest[f]["group"]) != "train"
                        or Path(f).name != f for f in files):
        raise ValueError("All diagnostic files must derive from frozen TRAIN source groups")
    service = str(ROOT / "local-llm/rag-api")
    if service not in sys.path:
        sys.path.append(service)
    concept_text = importlib.import_module("concepts_api").concept_text
    cases = []
    for file in sorted(files):
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
        contexts, sources = [], {}
        for path in sorted((ROOT / "ml/out/bundles" / stem).rglob("*.md")):
            if path.name in {"index.md", "log.md"}:
                continue
            markdown = path.read_text(encoding="utf-8")
            meta = yaml.safe_load(re.split(r"^---\s*$", markdown, maxsplit=2, flags=re.M)[1])
            text = concept_text(meta["title"], meta.get("description", ""), markdown)
            if not text.strip():
                continue
            contexts.append({"text": text, "page": meta["margin"]["page"], "title": meta["title"],
                             "kind": "concept", "type": meta["type"], "verified": False})
            sources[path.relative_to(ROOT).as_posix()] = gen.sha256(path)
        contexts.sort(key=lambda c: (-len(c["text"].encode("utf-8")), c["title"], c["page"]))
        if len(contexts) >= 3:
            cases.append({"file": file, "contexts": contexts[:8], "sources": sources})
    cases.sort(key=lambda c: (-sum(len(x["text"].encode("utf-8")) for x in
                                 bounded_contexts(c["contexts"], 8, 18000)), c["file"]))
    if len(cases) < 2:
        raise ValueError("Need two TRAIN documents with at least three cached concepts")
    return cases[:2]


def prepare(out=OUT):
    before = checkpoint_hashes()
    cases = training_cases()
    prompt, llm = gen.prompt_modules()
    sources = {name: gen.sha256(ROOT / name) for name in SOURCES}
    for case in cases:
        sources.update(case["sources"])
    records = make_records(cases, prompt.build_prompt)
    if any(len((llm.SYSTEM + r["prompt"]).encode("utf-8")) + 1024 > OPTIONS["num_ctx"] for r in records):
        raise ValueError("Diagnostic prompt exceeds conservative context allowance")
    plan = {"version": 1, "prepared_at": gen.now(), "model": gen.MODEL, "identity": gen.local_model_identity(),
            "options": OPTIONS, "system": llm.SYSTEM, "sources": sources, "records": records,
            "grading_checkpoint_hashes": before, "variants": VARIANTS,
            "selection": "Two longest bounded TRAIN concept bundles; fresh generic diagnostic prompt, no retrieval or gold questions"}
    if checkpoint_hashes() != before:
        raise ValueError("Grading checkpoint changed during preparation")
    out.mkdir(parents=True, exist_ok=True)
    gen.write_new(out / "plan.json", plan)
    gen.write_new(out / "preparation.json", {"plan_sha256": gen.sha256(out / "plan.json")})
    return plan


def load_plan(out=OUT):
    plan = gen.read(out / "plan.json")
    if (gen.sha256(out / "plan.json") != gen.read(out / "preparation.json")["plan_sha256"]
            or plan["options"] != OPTIONS or plan["variants"] != VARIANTS or len(plan["records"]) != 4
            or plan["model"] != gen.MODEL or plan["identity"] != gen.local_model_identity()
            or any(gen.sha256(ROOT / name) != value for name, value in plan["sources"].items())
            or plan["grading_checkpoint_hashes"] != checkpoint_hashes()):
        raise ValueError("Latency plan, sources, model or grading checkpoint changed")
    return plan


class StreamingOllama(gen.Ollama):
    def measure(self, plan, record, clock=time.monotonic):
        started, first_text, final = clock(), None, None
        parts = []
        with self.client.stream("POST", "/api/chat", json={"model": plan["model"], "stream": True,
                "messages": [{"role": "system", "content": plan["system"]},
                             {"role": "user", "content": record["prompt"]}], "options": plan["options"]}) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.strip():
                    continue
                data = json.loads(line)
                if final is not None or "error" in data or data.get("model") != plan["model"]:
                    raise ValueError("Invalid or failed stream; preserve attempt without retry")
                text = data.get("message", {}).get("content", "")
                if not isinstance(text, str):
                    raise ValueError("Invalid streamed text")
                if text:
                    if first_text is None and text.strip():
                        first_text = clock() - started
                    parts.append(text)
                if data.get("done") is True:
                    final = data
        elapsed = clock() - started
        if final is None or first_text is None or not "".join(parts).strip():
            raise ValueError("Incomplete or empty stream; do not automatically retry")
        if any(type(final.get(k)) is not int or final[k] < 0 for k in METRICS) or final["eval_count"] < 1:
            raise ValueError("Missing or invalid server timing metrics")
        return {"answer": "".join(parts), "first_text_seconds": first_text, "wall_seconds": elapsed,
                "done_reason": final.get("done_reason"), "metrics": {k: final[k] for k in METRICS}}


def summarise(plan, answers):
    samples = []
    for record in plan["records"]:
        event = answers[record["id"]]
        m = event["metrics"]
        samples.append({"case": record["case"], "variant": record["variant"], "contexts": record["contexts"],
                        "context_bytes": record["context_bytes"], "prompt_bytes": len(record["prompt"].encode("utf-8")),
                        "first_text_seconds": event["first_text_seconds"], "wall_seconds": event["wall_seconds"],
                        "load_seconds": m["load_duration"] / 1e9, "prompt_seconds": m["prompt_eval_duration"] / 1e9,
                        "output_seconds": m["eval_duration"] / 1e9, "server_total_seconds": m["total_duration"] / 1e9,
                        "prompt_tokens": m["prompt_eval_count"], "output_tokens": m["eval_count"],
                        "output_tokens_per_second": m["eval_count"] * 1e9 / m["eval_duration"] if m["eval_duration"] else None,
                        "done_reason": event["done_reason"]})
    fields = ("first_text_seconds", "wall_seconds", "load_seconds", "prompt_seconds", "output_seconds")
    return {"status": "complete", "recorded_at": gen.now(), "splits": ["train"], "documents": 2,
            "requests": len(samples), "options": plan["options"], "canonical_plan_sha256": gen.digest(plan),
            "selection": plan["selection"], "samples": samples,
            "means": {variant: {key: statistics.mean(s[key] for s in samples if s["variant"] == variant)
                                  for key in fields} for variant in VARIANTS},
            "quality_assessed": False, "live_defaults_changed": False,
            "limitations": "Two selected long-context TRAIN stress cases, one run per variant, counterbalanced order with uncontrolled cache reuse. First text is client receipt of a nonempty text chunk, not exact server token latency. Same 32K allocation, 3 threads and 128-token cap across variants; truncations retained. No gold answer quality or end-to-end retrieval/UI measurement; no statistical generalization."}


def execute(plan, out=OUT, report=REPORT, engine=None):
    if report.exists():
        raise FileExistsError("Latency report already exists; do not repeat requests")
    lock = out / "generation.lock"
    with lock.open("x", encoding="utf-8") as target:
        target.write(gen.now())
    state = None
    journal = out / "answers.jsonl"
    try:
        if checkpoint_hashes() != plan["grading_checkpoint_hashes"]:
            raise ValueError("Grading checkpoint changed")
        previous = gen.read(out / "state.json") if (out / "state.json").exists() else {}
        journal_hash = gen.sha256(journal) if journal.exists() else None
        if previous and (previous["plan_sha256"] != gen.digest(plan)
                         or previous.get("journal_sha256") != journal_hash):
            raise ValueError("Latency state or journal changed")
        answers = gen.journal_answers(journal, plan["records"], gen.digest(plan))
        state = {**previous, "status": "checking", "plan_sha256": gen.digest(plan)}
        engine = engine or StreamingOllama()
        for record in plan["records"]:
            if record["id"] in answers:
                continue
            identity = engine.identity()
            if (identity["model"] != plan["model"] or identity["digest"] != plan["identity"]["digest"]
                    or state.get("identity", identity) != identity):
                raise ValueError("Ollama model/version changed")
            state.update(status="running", identity=identity)
            base = {"id": record["id"], "plan_sha256": gen.digest(plan)}
            gen.append_event(journal, {**base, "status": "started", "at": gen.now()})
            try:
                result = engine.measure(plan, record)
                if not isinstance(result.get("answer"), str) or not result["answer"].strip():
                    raise ValueError("Empty retained answer")
                event = {**base, **result, "status": "complete", "at": gen.now()}
                gen.append_event(journal, event)
            except BaseException as error:
                gen.append_event(journal, {**base, "status": "failed", "at": gen.now(), "error_type": type(error).__name__})
                raise
            answers[record["id"]] = event
            print(f"Saved latency request {len(answers)}/{len(plan['records'])}; first text "
                  f"{event['first_text_seconds']:.1f}s, total {event['wall_seconds']:.1f}s", flush=True)
            state.update(completed=len(answers), journal_sha256=gen.sha256(journal))
            (out / "state.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        if checkpoint_hashes() != plan["grading_checkpoint_hashes"]:
            raise ValueError("Grading checkpoint changed during latency run")
        output = summarise(plan, answers)
        output.update(identity=state["identity"], journal_sha256=gen.sha256(journal), grading_checkpoint_unchanged=True)
        report.parent.mkdir(parents=True, exist_ok=True)
        gen.write_new(report, output)
        state.update(status="complete", completed=len(answers), report_sha256=gen.sha256(report))
        return output
    except BaseException as error:
        if state is not None:
            state.update(status="failed", error_type=type(error).__name__)
        raise
    finally:
        if state is not None:
            state.update(updated_at=gen.now(), journal_sha256=gen.sha256(journal) if journal.exists() else None)
            (out / "state.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        lock.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--run", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        plan = prepare()
        print(f"Prepared {len(plan['records'])} TRAIN-only latency requests; no model loaded")
    elif args.check:
        load_plan()
        print("Latency plan and paused grading checkpoint match; no model loaded")
    else:
        output = execute(load_plan())
        print(json.dumps(output["means"], indent=2))


if __name__ == "__main__":
    main()
