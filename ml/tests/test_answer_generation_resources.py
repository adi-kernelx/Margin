"""Resource amendments retain the sealed plan and use mocked Ollama only."""

import json

import httpx
import pytest

from ml.eval import answer_generation as gen, answer_generation_resources as resources
from ml.tests.test_answer_grading import Engine, plan


def checkpoint(tmp_path, monkeypatch):
    prepared = plan()
    gen.write_new(tmp_path / "plan.json", prepared)
    monkeypatch.setattr(gen, "load_plan", lambda out: prepared)
    gen.execute(prepared, tmp_path, limit=1, engine=Engine())
    return prepared


def test_amendment_preserves_plan_and_answer_bytes_and_resumes_at_three_threads(tmp_path, monkeypatch):
    prepared = checkpoint(tmp_path, monkeypatch)
    original_plan = (tmp_path / "plan.json").read_bytes()
    original_journal = (tmp_path / "answers.jsonl").read_bytes()
    profile = resources.configure(3, tmp_path)
    assert resources.load_amendment(prepared, tmp_path) == profile
    assert (tmp_path / "plan.json").read_bytes() == original_plan
    assert (tmp_path / "answers.jsonl").read_bytes() == original_journal
    requests = []
    def handler(request):
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": gen.MODEL, "digest": "a"*64}]})
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "test"})
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"model": gen.MODEL, "done": True, "message": {"content": "saved"}})
    client = httpx.Client(base_url="http://127.0.0.1:11434", transport=httpx.MockTransport(handler))
    engine = resources.AmendedOllama(prepared, profile, tmp_path, client)
    state = gen.execute(prepared, tmp_path, engine=engine)
    assert state["status"] == "complete" and len(requests) == 3
    assert all(r["options"] == {**gen.OPTIONS, "num_thread": 3} for r in requests)
    assert prepared["options"]["num_thread"] == 2
    assert (tmp_path / "answers.jsonl").read_bytes().startswith(original_journal)
    assert (tmp_path / "plan.json").read_bytes() == original_plan
    assert resources.load_amendment(prepared, tmp_path) == profile


def test_amendment_rejects_altered_boundary_or_nonthread_options(tmp_path, monkeypatch):
    prepared = checkpoint(tmp_path, monkeypatch)
    profile = resources.configure(3, tmp_path)
    profile["options"]["temperature"] = .2
    profile["amendment_sha256"] = gen.digest({k: v for k, v in profile.items() if k != "amendment_sha256"})
    (tmp_path / resources.PROFILE).write_text(json.dumps(profile))
    with pytest.raises(ValueError, match="beyond CPU threads"):
        resources.load_amendment(prepared, tmp_path)
    profile["options"]["temperature"] = .1
    profile["amendment_sha256"] = gen.digest({k: v for k, v in profile.items() if k != "amendment_sha256"})
    (tmp_path / resources.PROFILE).write_text(json.dumps(profile))
    journal = tmp_path / "answers.jsonl"
    journal.write_bytes(journal.read_bytes().replace(b"retained", b"modified"))
    with pytest.raises(ValueError, match="prefix changed"):
        resources.load_amendment(prepared, tmp_path)


def test_old_runner_cannot_silently_mix_further_two_thread_answers(tmp_path, monkeypatch):
    prepared = checkpoint(tmp_path, monkeypatch)
    resources.configure(3, tmp_path)
    gen.execute(prepared, tmp_path, limit=1, engine=Engine())
    with pytest.raises(ValueError, match="lacks the approved"):
        resources.load_amendment(prepared, tmp_path)


def test_configuration_does_not_replace_existing_amendment_or_lock(tmp_path, monkeypatch):
    checkpoint(tmp_path, monkeypatch)
    resources.configure(3, tmp_path)
    with pytest.raises(FileExistsError):
        resources.configure(4, tmp_path)
    assert gen.read(tmp_path / resources.PROFILE)["options"]["num_thread"] == 3
    (tmp_path / "generation.lock").write_text("busy")
    with pytest.raises(FileExistsError):
        resources.configure(3, tmp_path)
    assert (tmp_path / "generation.lock").read_text() == "busy"


def test_changed_profile_is_rejected_before_server_contact(tmp_path, monkeypatch):
    prepared = checkpoint(tmp_path, monkeypatch)
    profile = resources.configure(3, tmp_path)
    engine = resources.AmendedOllama(prepared, profile, tmp_path,
        httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("No network expected"))))
    with (tmp_path / resources.PROFILE).open("a") as target:
        target.write(" ")
    with pytest.raises(ValueError, match="changed between requests"):
        engine.identity()
