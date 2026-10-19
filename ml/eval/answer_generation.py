"""ML5.3: prepare saved-context answers, then generate only after CPU approval.

python -m ml.eval.answer_generation --prepare
python -m ml.eval.answer_generation --run --limit 2
"""

import argparse
import hashlib
import importlib.util
import json
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path

from ml.eval.ml5_protocol import BASELINE, PRIMARY, load_protocol, sha256

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "ml/models/artifacts/ml5"
OUT = ARTIFACTS / "grading"
MODEL = "qwen2.5:3b-instruct"
OPTIONS = {"temperature": 0.1, "num_predict": 512, "num_thread": 2, "num_gpu": 0, "num_ctx": 32768}
SOURCES = ("ml/eval/answer_generation.py", "ml/eval/answer_grading.py", "ml/eval/grading.html",
           "docs/ML5_GRADING.md", "local-llm/rag-api/prompt.py", "local-llm/rag-api/llm_client.py")


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_new(path, value):
    with path.open("x", encoding="utf-8") as target:
        json.dump(value, target, indent=2, ensure_ascii=False)
        target.write("\n")


def source_hashes():
    return {name: sha256(ROOT / name) for name in SOURCES}


def frozen_inputs():
    receipt = read(ARTIFACTS / "frozen_test_receipt.json")
    protocol = ARTIFACTS / "protocol.json"
    load_protocol(protocol)
    if receipt["status"] != "complete" or receipt["protocol_sha256"] != sha256(protocol):
        raise ValueError("Need the completed, unchanged frozen retrieval milestone")
    path = ARTIFACTS / "grading_inputs.json"
    if sha256(path) != receipt["grading_sha256"]:
        raise ValueError("Saved grading inputs do not match the milestone receipt")
    rows = read(path)
    if len(rows) != 50 or len({r["qid"] for r in rows}) != 50:
        raise ValueError("Need the original 50 unique grading inputs")
    for name in ("original", "independent"):
        selected = [r for r in rows if r["set"] == name]
        if len(selected) != 25 or sum(r["answerable"] for r in selected) != 20:
            raise ValueError("Grading sample must retain 20 answerable + 5 unanswerable per set")
    return rows, receipt


def prompt_modules():
    modules = []
    for name in ("prompt", "llm_client"):
        spec = importlib.util.spec_from_file_location("grading_" + name, ROOT / f"local-llm/rag-api/{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return modules


def local_model_identity(model_root=None):
    """Resolve an equivalent referenced manifest while retaining the wrapper hash."""
    model_root = model_root or Path.home() / ".ollama/models"
    path = model_root / "manifests/registry.ollama.ai/library/qwen2.5/3b-instruct"
    manifest = read(path)
    wrapper_hash = sha256(path)
    references = [layer for layer in manifest["layers"] if layer["mediaType"] ==
                  "application/vnd.docker.distribution.manifest.v2+json"]
    effective_hash = wrapper_hash
    if references:
        if len(references) != 1:
            raise ValueError("Ambiguous referenced model manifests")
        value = references[0]["digest"]
        if not value.startswith("sha256:") or len(value) != 71 or any(c not in "0123456789abcdef" for c in value[7:]):
            raise ValueError("Invalid referenced manifest digest")
        source = model_root / "blobs" / value.replace(":", "-")
        if sha256(source) != value[7:]:
            raise ValueError("Referenced model manifest hash mismatch")
        referenced = read(source)
        layers = [layer for layer in manifest["layers"] if layer not in references]
        if manifest["config"] != referenced["config"] or layers != referenced["layers"]:
            raise ValueError("Referenced manifest changes model/config/prompt layers")
        effective_hash = value[7:]
    return {"digest": effective_hash, "wrapper_sha256": wrapper_hash}


def make_records(rows, build_prompt):
    records = []
    for row in rows:
        if set(row["contexts"]) != {BASELINE, PRIMARY}:
            raise ValueError("Saved input must contain exactly both frozen methods")
        files = {c.get("pdfFingerprint") or c.get("docId") for items in row["contexts"].values() for c in items}
        files.discard(None)
        if len(files) != 1:
            raise ValueError("Cannot resolve one PDF for document-level grading intervals")
        for method in (BASELINE, PRIMARY):
            contexts = row["contexts"][method]
            if len(contexts) > 8:
                raise ValueError("Saved context budget exceeds the frozen top eight")
            safe = [{key: c[key] for key in ("text", "page", "kind", "type", "title", "verified") if key in c}
                    for c in contexts]
            packet = {"question": row["question"], "source_file": next(iter(files)), "answerable": row["answerable"],
                      "answer_pages": row["answer_pages"], "answer_quote": row["answer_quote"], "contexts": safe}
            records.append({"qid": row["qid"], "set": row["set"], "file": next(iter(files)), "method": method,
                            "prompt": build_prompt(row["question"], contexts, mode="qa"), "packet": packet})
    random.Random(20261018).shuffle(records)
    for index, record in enumerate(records, 1):
        record["id"] = f"A{index:03d}"
    return records


def prepare(out=OUT):
    rows, receipt = frozen_inputs()
    prompt, llm = prompt_modules()
    identity = local_model_identity()
    plan = {"version": 1, "model": MODEL, "model_digest": identity["digest"],
            "model_manifest_sha256": identity["wrapper_sha256"], "options": OPTIONS,
            "system": llm.SYSTEM, "protocol_sha256": receipt["protocol_sha256"],
            "input_sha256": receipt["grading_sha256"], "sources": source_hashes(),
            "presentation_seed": 20261018, "records": make_records(rows, prompt.build_prompt)}
    if any(len((plan["system"] + r["prompt"]).encode("utf-8")) + 1024 > OPTIONS["num_ctx"] for r in plan["records"]):
        raise ValueError("Prompt exceeds conservative UTF-8 byte/token bound plus output/template allowance")
    out.mkdir(parents=True, exist_ok=True)
    write_new(out / "plan.json", plan)
    write_new(out / "preparation.json", {"plan_sha256": sha256(out / "plan.json"), "prepared_at": now(),
                                        "status": "prepared_no_generation"})
    return plan


def load_plan(out=OUT):
    plan = read(out / "plan.json")
    seal = read(out / "preparation.json")
    _, receipt = frozen_inputs()
    identity = local_model_identity()
    if (sha256(out / "plan.json") != seal["plan_sha256"] or plan["sources"] != source_hashes() or
            plan["input_sha256"] != receipt["grading_sha256"] or plan["protocol_sha256"] != receipt["protocol_sha256"] or
            plan["model"] != MODEL or plan["options"] != OPTIONS or len(plan["records"]) != 100 or
            plan["model_digest"] != identity["digest"] or plan["model_manifest_sha256"] != identity["wrapper_sha256"]):
        raise ValueError("Prepared plan, frozen inputs or generation sources changed")
    return plan


class Ollama:
    """Local-only native transport; it never launches or pulls a model."""
    def __init__(self, client=None):
        import httpx
        self.client = client or httpx.Client(base_url="http://127.0.0.1:11434", trust_env=False, timeout=600)

    def identity(self):
        response = self.client.get("/api/tags", timeout=5)
        response.raise_for_status()
        matches = [m for m in response.json()["models"] if m["name"] == MODEL]
        if len(matches) != 1:
            raise ValueError("The preregistered model must already be installed in running Ollama")
        version = self.client.get("/api/version", timeout=5)
        version.raise_for_status()
        return {"model": MODEL, "digest": matches[0]["digest"].removeprefix("sha256:"),
                "ollama_version": version.json()["version"]}

    def answer(self, plan, record):
        response = self.client.post("/api/chat", json={"model": plan["model"], "stream": False,
            "messages": [{"role": "system", "content": plan["system"]}, {"role": "user", "content": record["prompt"]}],
            "options": plan["options"]})
        response.raise_for_status()
        data = response.json()
        text = data.get("message", {}).get("content")
        if data.get("model") != plan["model"] or data.get("done") is not True or not isinstance(text, str) or not text.strip():
            raise ValueError("Incomplete or empty generation response; do not automatically regenerate")
        return {"answer": text, **{k: data.get(k) for k in
            ("done_reason", "prompt_eval_count", "eval_count", "total_duration", "load_duration")}}


def append_event(path, event):
    with path.open("a", encoding="utf-8") as target:
        target.write(json.dumps(event, ensure_ascii=False) + "\n")
        target.flush()
        os.fsync(target.fileno())


def journal_answers(path, records, plan_hash):
    known = {r["id"] for r in records}
    started, answers = set(), {}
    if not path.exists():
        return answers
    for line in path.read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        item = event["id"]
        if item not in known or event["plan_sha256"] != plan_hash:
            raise ValueError("Generation journal does not match its prepared plan")
        if event["status"] == "started" and item not in started:
            started.add(item)
        elif event["status"] == "complete" and item in started and item not in answers:
            if not isinstance(event.get("answer"), str) or not event["answer"].strip():
                raise ValueError("Empty saved answer")
            answers[item] = event
        else:
            raise ValueError("Failed, duplicate or invalid generation attempt; manual diagnosis required")
    if started != set(answers):
        raise ValueError("Unresolved generation attempt; do not automatically retry or delete the journal")
    return answers


def finish_packet(plan, answers, out):
    from ml.eval.answer_grading import packet_from_answers
    packet, key = packet_from_answers(plan, answers)
    for name, value in (("blind_packet.json", packet), ("private_key.json", key)):
        path = out / name
        if path.exists():
            if read(path) != value:
                raise ValueError("Existing grading export differs from the saved answers")
        else:
            write_new(path, value)
    return packet


def execute(plan, out=OUT, limit=None, engine=None):
    if limit is not None and limit < 1:
        raise ValueError("Batch limit must be positive")
    plan_hash = digest(plan)
    lock = out / "generation.lock"
    with lock.open("x", encoding="utf-8") as target:
        target.write(now())
    state_path, journal = out / "generation_state.json", out / "answers.jsonl"
    state = None
    try:
        previous = read(state_path) if state_path.exists() else {}
        if previous and previous["plan_sha256"] != plan_hash:
            raise ValueError("Generation state belongs to another plan")
        if previous.get("journal_sha256") and sha256(journal) != previous["journal_sha256"]:
            raise ValueError("Saved answer journal changed since the last batch")
        answers = journal_answers(journal, plan["records"], plan_hash)
        state = {**previous, "status": "checking", "plan_sha256": plan_hash, "updated_at": now()}
        remaining = [r for r in plan["records"] if r["id"] not in answers]
        if remaining:
            engine = engine or Ollama()
            identity = engine.identity()
            if identity["digest"] != plan["model_digest"] or identity["model"] != plan["model"]:
                raise ValueError("Running model differs from the prepared model digest")
            if previous.get("identity") not in (None, identity):
                raise ValueError("Ollama version/model changed between answer batches")
            state.update(status="running", identity=identity)
            state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
            for record in remaining[:limit] if limit is not None else remaining:
                if engine.identity() != identity:
                    raise ValueError("Ollama version/model changed before the next answer")
                base = {"id": record["id"], "plan_sha256": plan_hash}
                append_event(journal, {**base, "status": "started", "at": now(), "prompt_sha256": digest(record["prompt"])})
                started = time.monotonic()
                try:
                    result = engine.answer(plan, record)
                    if not isinstance(result.get("answer"), str) or not result["answer"].strip():
                        raise ValueError("Empty answer; do not automatically retry")
                    event = {**base, **result, "status": "complete", "at": now(),
                             "wall_seconds": time.monotonic() - started}
                    append_event(journal, event)
                except BaseException as error:
                    append_event(journal, {**base, "status": "failed", "at": now(), "error_type": type(error).__name__})
                    raise
                answers[record["id"]] = event
                print(f"Saved answer {len(answers)}/{len(plan['records'])} ({event['wall_seconds']:.1f}s)", flush=True)
        state.update(status="complete" if len(answers) == len(plan["records"]) else "paused_between_batches",
                     completed=len(answers), total=len(plan["records"]), journal_sha256=sha256(journal))
        if state["status"] == "complete":
            finish_packet(plan, answers, out)
            state["packet_sha256"] = sha256(out / "blind_packet.json")
            state["key_sha256"] = sha256(out / "private_key.json")
        return state
    except BaseException as error:
        if state is not None:
            state.update(status="failed", error_type=type(error).__name__)
        raise
    finally:
        if state is not None:
            state["updated_at"] = now()
            state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        lock.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--preflight", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--limit", type=int, help="Generate at most this many new answers, preserving completed ones")
    args = parser.parse_args()
    if args.limit is not None and (not args.run or args.limit < 1):
        parser.error("A positive --limit requires --run")
    if args.prepare:
        plan = prepare()
        print(f"Prepared {len(plan['records'])} prompts; no LLM, retrieval or question-file read")
    elif args.preflight:
        plan = load_plan()
        identity = Ollama().identity()  # metadata GET only: no model load, generation or server launch
        if identity["digest"] != plan["model_digest"]:
            raise ValueError("Running server model digest differs from the prepared plan")
        print("Plan and frozen inputs match; Ollama metadata matches. No model generation requested.")
    else:
        print(json.dumps(execute(load_plan(), limit=args.limit), indent=2))


if __name__ == "__main__":
    main()
