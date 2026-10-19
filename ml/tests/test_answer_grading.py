"""Generation/checkpoint and blind grading tests use synthetic prompts only."""
import copy
import json
from pathlib import Path

import httpx
import pytest

from ml.eval import answer_generation as gen, answer_grading as grading
from ml.eval.ml5_protocol import BASELINE, PRIMARY


def inputs(count=2):
    return [{"qid": f"original:q{i}", "set": "original", "question": f"Question {i}", "answerable": i % 2 == 0,
             "answer_pages": [1] if i % 2 == 0 else [], "answer_quote": "SECRET GOLD" if i % 2 == 0 else "",
             "contexts": {method: [{"pdfFingerprint": "toy.pdf", "page": 1, "text": "SUPPLIED CONTEXT",
                "kind": "passage", "score": 9.0, "cross_encoder": 7.0}] for method in (BASELINE, PRIMARY)}} for i in range(count)]


def plan():
    return {"model": gen.MODEL, "model_digest": "a"*64, "system": "frozen system", "options": gen.OPTIONS,
            "records": gen.make_records(inputs(), lambda question, contexts, mode: question + contexts[0]["text"])}


class Engine:
    def __init__(self, fail=False, version="test"):
        self.calls = []
        self.fail, self.version = fail, version

    def identity(self):
        return {"model": gen.MODEL, "digest": "a"*64, "ollama_version": self.version}

    def answer(self, prepared, record):
        self.calls.append(record["id"])
        if self.fail:
            raise TimeoutError("synthetic failure")
        return {"answer": "A retained answer", "done_reason": "stop"}


def test_preparation_uses_only_saved_context_and_never_gold_in_prompt():
    rows = inputs()
    records = gen.make_records(rows, lambda q, ctx, mode: q + ctx[0]["text"])
    assert records == gen.make_records(rows, lambda q, ctx, mode: q + ctx[0]["text"])
    assert len(records) == 4 and {r["id"] for r in records} == {"A001", "A002", "A003", "A004"}
    assert all("SECRET GOLD" not in r["prompt"] and "SUPPLIED CONTEXT" in r["prompt"] for r in records)
    assert all(set(r["packet"]["contexts"][0]) == {"text", "page", "kind"} for r in records)
    rows[0]["contexts"][PRIMARY][0]["pdfFingerprint"] = "different.pdf"
    with pytest.raises(ValueError, match="one PDF"):
        gen.make_records(rows, lambda *a, **k: "prompt")


def test_real_frozen_prompt_remains_unchanged_and_does_not_receive_gold():
    prompt, llm = gen.prompt_modules()
    records = gen.make_records(inputs(), prompt.build_prompt)
    assert llm.SYSTEM == "You are a strict document QA assistant."
    assert all("SECRET GOLD" not in r["prompt"] for r in records)
    assert gen.OPTIONS == {"temperature": .1, "num_predict": 512, "num_thread": 2, "num_gpu": 0, "num_ctx": 32768}


def test_batches_resume_without_regeneration_and_completed_run_needs_no_server(tmp_path):
    prepared, engine = plan(), Engine()
    state = gen.execute(prepared, tmp_path, limit=1, engine=engine)
    assert state["status"] == "paused_between_batches" and len(engine.calls) == 1
    assert not (tmp_path / "blind_packet.json").exists()
    gen.execute(prepared, tmp_path, engine=engine)
    assert len(engine.calls) == len(set(engine.calls)) == 4
    final = gen.execute(prepared, tmp_path, engine=Engine(fail=True))
    assert final["status"] == "complete" and final["identity"]["ollama_version"] == "test"
    packet = gen.read(tmp_path / "blind_packet.json")
    assert packet["packet_id"] == gen.digest(packet["records"])
    assert all(not {"method", "qid", "set", "score"} & r.keys() for r in packet["records"])


def test_failed_or_unresolved_attempt_is_not_automatically_retried(tmp_path):
    prepared, engine = plan(), Engine(fail=True)
    with pytest.raises(TimeoutError):
        gen.execute(prepared, tmp_path, engine=engine)
    assert gen.read(tmp_path / "generation_state.json")["status"] == "failed"
    with pytest.raises(ValueError, match="manual diagnosis"):
        gen.execute(prepared, tmp_path, engine=engine)
    assert len(engine.calls) == 1 and not (tmp_path / "generation.lock").exists()
    other = tmp_path / "unresolved.jsonl"
    gen.append_event(other, {"id": "A001", "plan_sha256": "hash", "status": "started"})
    with pytest.raises(ValueError, match="Unresolved"):
        gen.journal_answers(other, prepared["records"], "hash")


def test_changed_server_version_or_journal_blocks_resume(tmp_path):
    prepared = plan()
    gen.execute(prepared, tmp_path, limit=1, engine=Engine())
    with pytest.raises(ValueError, match="changed between"):
        gen.execute(prepared, tmp_path, engine=Engine(version="changed"))
    assert gen.read(tmp_path / "generation_state.json")["identity"]["ollama_version"] == "test"
    with (tmp_path / "answers.jsonl").open("a", encoding="utf-8") as target:
        target.write("\n")
    with pytest.raises(ValueError, match="journal changed"):
        gen.execute(prepared, tmp_path, engine=Engine())


def test_existing_lock_prevents_concurrent_generation(tmp_path):
    (tmp_path / "generation.lock").write_text("already running")
    with pytest.raises(FileExistsError):
        gen.execute(plan(), tmp_path, engine=Engine())
    assert (tmp_path / "generation.lock").read_text() == "already running"


def test_native_transport_pins_payload_and_rejects_empty_responses():
    requests = []
    def handler(request):
        requests.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": gen.MODEL, "digest": "sha256:" + "a"*64}]})
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "test"})
        return httpx.Response(200, json={"model": gen.MODEL, "done": True, "message": {"content": "retained"}, "done_reason": "length"})
    engine = gen.Ollama(httpx.Client(base_url="http://127.0.0.1:11434", transport=httpx.MockTransport(handler)))
    prepared = plan()
    assert engine.identity()["digest"] == "a"*64
    result = engine.answer(prepared, prepared["records"][0])
    payload = json.loads(requests[-1].content)
    assert payload["options"] == gen.OPTIONS and payload["stream"] is False
    assert len(payload["messages"]) == 2 and "SECRET GOLD" not in payload["messages"][1]["content"]
    assert result["done_reason"] == "length"  # Preserve truncations; never retry based on quality.
    engine.client = httpx.Client(base_url="http://127.0.0.1:11434", transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"done": True, "message": {"content": ""}})))
    with pytest.raises(ValueError, match="Incomplete or empty"):
        engine.answer(prepared, prepared["records"][0])


def judged_packet():
    prepared = plan()
    answers = {r["id"]: {"answer": "retained answer"} for r in prepared["records"]}
    packet, key = grading.packet_from_answers(prepared, answers)
    ratings = []
    for row in packet["records"]:
        full = key["records"][row["id"]]["method"] == PRIMARY
        ratings.append({"id": row["id"], "correctness": 2 if full else 1, "grounding": 2 if full else 1,
                        "abstained": not row["answerable"] if full else False,
                        "correct_abstention": None if row["answerable"] else full, "notes": "private notes"})
    return packet, key, {"version": 1, "packet_id": packet["packet_id"], "ratings": ratings}


def test_grading_requires_complete_unique_valid_ratings_before_results():
    packet, key, ratings = judged_packet()
    report = grading.grading_report(packet, key, ratings)
    assert report["answers"] == 4 and report["pooled"]["questions"] == 2
    assert report["pooled"]["documents"] == 1
    assert report["pooled"]["paired"]["correctness"]["value"] == 1
    assert report["pooled"]["methods"][PRIMARY]["correct_abstention_count"] == 1
    assert "private notes" not in json.dumps(report) and not report["retrieval_decision_changed"]
    for bad in ({**ratings, "ratings": ratings["ratings"][:-1]},
                {**ratings, "ratings": [*ratings["ratings"], ratings["ratings"][0]]},
                {**ratings, "packet_id": "changed"}):
        with pytest.raises(ValueError):
            grading.grading_report(packet, key, bad)
    bad = copy.deepcopy(ratings)
    bad["ratings"][0]["correctness"] = True
    with pytest.raises(ValueError):
        grading.validate_ratings(bad, packet)


def test_cli_needs_explicit_mode_and_limit_cannot_prepare(monkeypatch):
    for args in ([], ["--prepare", "--limit", "1"], ["--run", "--limit", "0"]):
        monkeypatch.setattr("sys.argv", ["answer_generation", *args])
        with pytest.raises(SystemExit):
            gen.main()


def test_saved_input_receipt_and_balanced_sample_are_required(tmp_path, monkeypatch):
    monkeypatch.setattr(gen, "ARTIFACTS", tmp_path)
    monkeypatch.setattr(gen, "load_protocol", lambda path: {})
    (tmp_path / "protocol.json").write_text("{}", encoding="utf-8")
    rows = []
    for name in ("original", "independent"):
        for i in range(25):
            row = inputs(1)[0]
            row.update(qid=f"{name}:{i}", set=name, answerable=i<20)
            rows.append(row)
    path = tmp_path / "grading_inputs.json"
    path.write_text(json.dumps(rows), encoding="utf-8")
    receipt = {"status": "complete", "protocol_sha256": gen.sha256(tmp_path / "protocol.json"),
               "grading_sha256": gen.sha256(path)}
    (tmp_path / "frozen_test_receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
    assert len(gen.frozen_inputs()[0]) == 50
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="receipt"):
        gen.frozen_inputs()


def test_prepared_plan_seal_rejects_prompt_changes(tmp_path, monkeypatch):
    prepared = plan()
    prepared.update(records=gen.make_records(inputs(50), lambda *a, **k: "fixed"),
                    sources={"source": "hash"}, input_sha256="input", protocol_sha256="protocol",
                    model_manifest_sha256="wrapper")
    monkeypatch.setattr(gen, "source_hashes", lambda: {"source": "hash"})
    monkeypatch.setattr(gen, "local_model_identity", lambda: {"digest": "a"*64, "wrapper_sha256": "wrapper"})
    monkeypatch.setattr(gen, "frozen_inputs", lambda: ([], {"grading_sha256": "input", "protocol_sha256": "protocol"}))
    gen.write_new(tmp_path / "plan.json", prepared)
    gen.write_new(tmp_path / "preparation.json", {"plan_sha256": gen.sha256(tmp_path / "plan.json")})
    assert gen.load_plan(tmp_path) == prepared
    prepared["records"][0]["prompt"] = "changed"
    (tmp_path / "plan.json").write_text(json.dumps(prepared), encoding="utf-8")
    with pytest.raises(ValueError, match="changed"):
        gen.load_plan(tmp_path)


def test_grading_cli_rejects_frozen_question_path_before_any_read(monkeypatch):
    monkeypatch.setattr("sys.argv", ["answer_grading", "--ratings", str(gen.ROOT / "ml/eval/questions.jsonl"), "--out", "unused.json"])
    monkeypatch.setattr(gen, "load_plan", lambda: pytest.fail("Must reject before reading any plan or questions"))
    with pytest.raises(SystemExit, match="cannot be used"):
        grading.main()


def test_wrapper_manifest_accepts_only_hash_verified_equivalent_reference(tmp_path):
    import hashlib
    folder = tmp_path / "manifests/registry.ollama.ai/library/qwen2.5"
    folder.mkdir(parents=True)
    (tmp_path / "blobs").mkdir()
    base = {"config": {"digest": "config"}, "layers": [{"mediaType": "model", "digest": "weights"},
                                                       {"mediaType": "template", "digest": "prompt"}]}
    raw = json.dumps(base).encode()
    digest = hashlib.sha256(raw).hexdigest()
    blob = tmp_path / "blobs" / ("sha256-" + digest)
    blob.write_bytes(raw)
    outer = copy.deepcopy(base)
    outer["layers"].append({"mediaType": "application/vnd.docker.distribution.manifest.v2+json", "digest": "sha256:" + digest})
    manifest = folder / "3b-instruct"
    manifest.write_text(json.dumps(outer), encoding="utf-8")
    assert gen.local_model_identity(tmp_path) == {"digest": digest, "wrapper_sha256": gen.sha256(manifest)}
    outer["layers"][1]["digest"] = "different prompt"
    manifest.write_text(json.dumps(outer), encoding="utf-8")
    with pytest.raises(ValueError, match="changes"):
        gen.local_model_identity(tmp_path)
    blob.write_text("changed", encoding="utf-8")
    with pytest.raises(ValueError, match="hash mismatch"):
        gen.local_model_identity(tmp_path)


def test_unwrapped_manifest_retains_its_own_digest(tmp_path):
    folder = tmp_path / "manifests/registry.ollama.ai/library/qwen2.5"
    folder.mkdir(parents=True)
    manifest = folder / "3b-instruct"
    manifest.write_text(json.dumps({"config": {}, "layers": []}), encoding="utf-8")
    identity = gen.local_model_identity(tmp_path)
    assert identity["digest"] == identity["wrapper_sha256"] == gen.sha256(manifest)
