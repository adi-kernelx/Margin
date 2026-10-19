"""Resource recovery invariants; no process changes, corpus access or model load."""

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from ml.eval import answer_generation as g, memory_safe_completion as m

GIB = 1024**3


def test_preload_reserve_is_needed_even_when_current_ram_usage_is_low():
    assert m.enough_memory(10*GIB, 6*GIB, False)
    assert not m.enough_memory(10*GIB, 5*GIB, False)
    assert m.enough_memory(10*GIB, 2*GIB, True)
    assert not m.enough_memory(10*GIB, int(1.9*GIB), True)


class Process:
    def __init__(self, pid, path, children=()):
        self.pid, self.path, self.items, self.terminated, self.priority = pid, path, children, False, None

    def exe(self): return self.path
    def children(self, recursive): return self.items
    def terminate(self): self.terminated = True
    def nice(self, value): self.priority = value


def system(available):
    runner = Process(2, str(Path("C:/Ollama") / "lib/ollama/llama-server.exe"))
    other = Process(3, "C:/Other/llama-server.exe")
    parent = Process(1, "C:/Ollama/ollama.exe", [runner, other])
    api = SimpleNamespace(Process=lambda pid: parent, virtual_memory=lambda:SimpleNamespace(total=10*GIB, available=available),
                          cpu_percent=lambda interval:20, BELOW_NORMAL_PRIORITY_CLASS=16384, NoSuchProcess=LookupError)
    return api, runner, other


def test_high_memory_stops_only_verified_ollama_child_and_records_event(tmp_path):
    api, runner, other = system(int(1.9*GIB))
    guard = m.MemoryGuard(1,tmp_path,api)
    guard.poll()
    assert guard.emergency.is_set() and runner.terminated and not other.terminated
    assert runner.priority == 16384 and other.priority is None
    assert "memory_emergency_stop" in (tmp_path/"resource_events.jsonl").read_text()
    with pytest.raises(RuntimeError,match="no automatic retry"):
        guard.ready()


def test_normal_headroom_keeps_runner_and_sets_background_priority_once(tmp_path):
    api, runner, other = system(3*GIB)
    guard = m.MemoryGuard(1,tmp_path,api)
    assert guard.ready()
    guard.poll();guard.poll()
    assert not runner.terminated and not other.terminated and not guard.emergency.is_set()
    assert (tmp_path/"resource_events.jsonl").read_text().count("lower_priority") == 1


def test_total_cpu_pressure_waits_between_answers_without_killing_a_model(tmp_path):
    api, runner, _ = system(4*GIB)
    api.cpu_percent = lambda interval:90
    guard = m.MemoryGuard(1,tmp_path,api)
    assert not guard.ready() and not runner.terminated


def test_recovery_preserves_failure_history_and_copies_only_successful_prefix(tmp_path,monkeypatch):
    original, out, resumed = tmp_path/"original", tmp_path/"completion", tmp_path/"resumed"
    original.mkdir();out.mkdir()
    monkeypatch.setattr(m,"ROOT",tmp_path)
    monkeypatch.setattr(g,"OUT",original)
    monkeypatch.setattr(m,"SOURCES",("code.py","protocol.md"))
    for name in m.SOURCES: (tmp_path/name).write_text("sealed")
    plan = {"options":{"num_thread":2}}
    g.write_new(original/"plan.json",plan)
    g.write_new(original/"preparation.json",{"source":"same"})
    g.write_new(original/m.resources.PROFILE,{"options":{"num_thread":3}})
    prefix = b'{"status":"complete","id":"A001"}\n'
    failed = b'{"status":"started","id":"A013"}\n{"status":"failed","id":"A013"}\n'
    (original/"answers.jsonl").write_bytes(prefix+failed)
    g.write_new(original/"generation_state.json",{"status":"failed","error_type":"HTTPStatusError","completed":12})
    snapshot = {"protected":{"original/plan.json":g.sha256(original/"plan.json")},"authorized_mutable":[],
                "journal_prefix_bytes":len(prefix),"journal_prefix_sha256":hashlib.sha256(prefix).hexdigest(),
                "plan_sha256":g.digest(plan),"options":{"num_thread":3}}
    g.write_new(out/"checkpoint.json",snapshot)
    g.write_new(out/"memory_interruption.json",{"journal_sha256":g.sha256(original/"answers.jsonl"),"state_sha256":g.sha256(original/"generation_state.json")})
    monkeypatch.setattr(g,"load_plan",lambda path:g.read(path/"plan.json"))
    monkeypatch.setattr(m.resources,"load_amendment",lambda plan,path:g.read(path/m.resources.PROFILE))
    receipt = m.prepare(out,resumed)
    assert (original/"answers.jsonl").read_bytes() == prefix+failed
    assert (resumed/"answers.jsonl").read_bytes() == prefix
    assert (resumed/"plan.json").read_bytes() == (original/"plan.json").read_bytes()
    assert receipt["administrative_retry_ids"] == ["A013"] and not receipt["inference_settings_changed"]
    assert g.read(resumed/"generation_state.json")["status"] == "paused_between_batches"
    with pytest.raises(FileExistsError): m.prepare(out,resumed)
