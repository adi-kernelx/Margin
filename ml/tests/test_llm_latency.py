"""Latency probe uses synthetic TRAIN data and an HTTP mock, without models."""

import json

import httpx
import pytest

from ml.eval import answer_generation as gen, llm_latency as latency


def prepared():
    contexts = [{"text": "Long source passage " * 500, "page": i, "kind": "concept", "title": str(i)} for i in range(1, 9)]
    cases = [{"file": f"train{i}.pdf", "contexts": contexts} for i in range(2)]
    prompt, llm = gen.prompt_modules()
    return {"model": gen.MODEL, "identity": {"digest": "a"*64}, "options": latency.OPTIONS,
            "system": llm.SYSTEM, "grading_checkpoint_hashes": {"checkpoint": "unchanged"},
            "selection": "synthetic", "records": latency.make_records(cases, prompt.build_prompt)}


def chunks(**overrides):
    metrics = {"total_duration": 9_000_000_000, "load_duration": 1_000_000_000,
               "prompt_eval_count": 100, "prompt_eval_duration": 5_000_000_000,
               "eval_count": 20, "eval_duration": 2_000_000_000}
    return [{"model": gen.MODEL, "message": {"content": "\n"}, "done": False},
            {"model": gen.MODEL, "message": {"content": "First "}, "done": False},
            {"model": gen.MODEL, "message": {"content": "answer"}, "done": False},
            {"model": gen.MODEL, "message": {"content": ""}, "done": True, "done_reason": "length",
             **metrics, **overrides}]


def client_for(events, requests=None):
    def handler(request):
        if requests is not None:
            requests.append(json.loads(request.content))
        return httpx.Response(200, text="\n".join(json.dumps(e) for e in events))
    return httpx.Client(base_url="http://127.0.0.1:11434", transport=httpx.MockTransport(handler))


def test_utf8_context_budget_and_paired_prompts_exclude_gold():
    contexts = [{"text": "λ "*100, "page": 1}, {"text": "second", "page": 2}]
    selected = latency.bounded_contexts(contexts, 2, 25)
    assert 0 < sum(len(c["text"].encode()) for c in selected) <= 25
    assert contexts[0]["text"] == "λ "*100
    plan = prepared()
    assert [r["variant"] for r in plan["records"]] == ["full", "bounded", "bounded", "full"]
    assert len({r["id"] for r in plan["records"]}) == 4
    for r in plan["records"]:
        assert r["context_bytes"] <= latency.VARIANTS[r["variant"]]["bytes"]
        assert r["contexts"] <= latency.VARIANTS[r["variant"]]["contexts"]
        assert "gold" not in r["prompt"]


def test_stream_times_first_nonwhitespace_text_and_retains_length_stop():
    requests, ticks = [], iter([10., 16., 19.])
    plan = prepared()
    engine = latency.StreamingOllama(client_for(chunks(), requests))
    result = engine.measure(plan, plan["records"][0], clock=lambda: next(ticks))
    assert result["first_text_seconds"] == 6 and result["wall_seconds"] == 9
    assert result["answer"] == "\nFirst answer" and result["done_reason"] == "length"
    assert requests[0]["stream"] is True and requests[0]["options"] == latency.OPTIONS
    assert result["metrics"]["prompt_eval_duration"] == 5_000_000_000


@pytest.mark.parametrize("events", [chunks()[:-1], chunks(prompt_eval_duration=None),
    [{"error": "synthetic"}], chunks(eval_count=True),
    [{"model": "changed", "message": {"content": "text"}}], chunks() + chunks()])
def test_invalid_or_incomplete_stream_is_rejected_without_retry(events):
    requests = []
    engine = latency.StreamingOllama(client_for(events, requests))
    plan = prepared()
    with pytest.raises(ValueError):
        engine.measure(plan, plan["records"][0])
    assert len(requests) == 1


class Engine:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def identity(self):
        return {"model": gen.MODEL, "digest": "a"*64, "ollama_version": "test"}

    def measure(self, plan, record):
        self.calls.append(record["id"])
        if self.fail:
            raise TimeoutError("synthetic")
        return {"answer": "PRIVATE ANSWER", "first_text_seconds": 6., "wall_seconds": 9.,
                "done_reason": "length", "metrics": {k: v for k, v in chunks()[-1].items() if k in latency.METRICS}}


def test_journal_results_are_private_and_report_contains_only_metrics(tmp_path, monkeypatch):
    plan, engine, report = prepared(), Engine(), tmp_path / "report.json"
    monkeypatch.setattr(latency, "checkpoint_hashes", lambda: {"checkpoint": "unchanged"})
    output = latency.execute(plan, tmp_path, report, engine)
    assert len(engine.calls) == len(set(engine.calls)) == 4
    assert output["grading_checkpoint_unchanged"] and not output["quality_assessed"]
    assert output["means"]["full"]["prompt_seconds"] == 5
    assert all(s["output_tokens_per_second"] == 10 for s in output["samples"])
    assert "PRIVATE ANSWER" not in json.dumps(output) and "Long source" not in json.dumps(output)
    assert "train0.pdf" not in json.dumps(output) and output["options"]["num_thread"] == 3
    assert not (tmp_path / "generation.lock").exists()
    with pytest.raises(FileExistsError):
        latency.execute(plan, tmp_path, report, engine)
    assert len(engine.calls) == 4


def test_failed_attempt_is_retained_and_never_automatically_repeated(tmp_path, monkeypatch):
    plan, engine, report = prepared(), Engine(fail=True), tmp_path / "report.json"
    monkeypatch.setattr(latency, "checkpoint_hashes", lambda: {"checkpoint": "unchanged"})
    with pytest.raises(TimeoutError):
        latency.execute(plan, tmp_path, report, engine)
    state = (tmp_path / "state.json").read_bytes()
    with pytest.raises(ValueError, match="manual diagnosis"):
        latency.execute(plan, tmp_path, report, engine)
    assert (tmp_path / "state.json").read_bytes() == state and len(engine.calls) == 1


def test_clean_checkpoint_resumes_only_unstarted_requests(tmp_path, monkeypatch):
    plan, engine = prepared(), Engine()
    monkeypatch.setattr(latency, "checkpoint_hashes", lambda: {"checkpoint": "unchanged"})
    record = plan["records"][0]
    journal = tmp_path / "answers.jsonl"
    base = {"id": record["id"], "plan_sha256": gen.digest(plan)}
    gen.append_event(journal, {**base, "status": "started"})
    gen.append_event(journal, {**base, **Engine().measure(plan, record), "status": "complete"})
    prefix = journal.read_bytes()
    gen.write_new(tmp_path / "state.json", {"plan_sha256": gen.digest(plan),
        "journal_sha256": gen.sha256(journal), "identity": engine.identity(), "completed": 1})
    output = latency.execute(plan, tmp_path, tmp_path / "report.json", engine)
    assert len(engine.calls) == 3 and record["id"] not in engine.calls
    assert journal.read_bytes().startswith(prefix) and output["requests"] == 4


def test_journal_tampering_and_changed_grading_checkpoint_block_generation(tmp_path, monkeypatch):
    plan, engine = prepared(), Engine()
    monkeypatch.setattr(latency, "checkpoint_hashes", lambda: {"checkpoint": "changed"})
    with pytest.raises(ValueError, match="Grading checkpoint changed"):
        latency.execute(plan, tmp_path, tmp_path / "report.json", engine)
    assert not engine.calls and not (tmp_path / "state.json").exists()
    monkeypatch.setattr(latency, "checkpoint_hashes", lambda: {"checkpoint": "unchanged"})
    journal = tmp_path / "answers.jsonl"
    journal.write_text("[]\n")
    gen.write_new(tmp_path / "state.json", {"plan_sha256": gen.digest(plan), "journal_sha256": "old"})
    state = (tmp_path / "state.json").read_bytes()
    with pytest.raises(ValueError, match="state or journal changed"):
        latency.execute(plan, tmp_path, tmp_path / "report.json", engine)
    assert (tmp_path / "state.json").read_bytes() == state and not engine.calls


def test_train_source_gate_precedes_any_bundle_read(tmp_path, monkeypatch):
    (tmp_path / "ml/models/artifacts/ml5").mkdir(parents=True)
    (tmp_path / "Test PDFs").mkdir()
    gen.write_new(tmp_path / "ml/splits.json", {"status": "frozen", "train_groups": ["train"],
        "test_groups": ["test"], "excluded_groups": []})
    (tmp_path / "Test PDFs/manifest.csv").write_text("file,group\nfrozen.pdf,test\n")
    gen.write_new(tmp_path / "ml/models/artifacts/ml5/protocol.json", {"train_files": ["frozen.pdf"]})
    monkeypatch.setattr(latency, "ROOT", tmp_path)
    with pytest.raises(ValueError, match="TRAIN source groups"):
        latency.training_cases()


def test_preparation_and_source_seals_need_no_network(tmp_path, monkeypatch):
    monkeypatch.setattr(latency, "ROOT", tmp_path)
    monkeypatch.setattr(latency, "SOURCES", ("source.py",))
    (tmp_path / "source.py").write_text("fixed")
    monkeypatch.setattr(latency, "checkpoint_hashes", lambda: {"checkpoint": "unchanged"})
    monkeypatch.setattr(gen, "local_model_identity", lambda: {"digest": "a"*64})
    monkeypatch.setattr(latency, "training_cases", lambda: [
        {"file": f"train{i}.pdf", "contexts": [{"text": "source", "page": 1}], "sources": {}} for i in range(2)])
    plan = latency.prepare(tmp_path / "out")
    assert latency.load_plan(tmp_path / "out") == plan
    (tmp_path / "source.py").write_text("changed")
    with pytest.raises(ValueError, match="changed"):
        latency.load_plan(tmp_path / "out")
