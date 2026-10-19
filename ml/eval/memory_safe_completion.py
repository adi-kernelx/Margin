"""Resource-only recovery of the interrupted ML5.3 run; no inference changes."""

import argparse
import hashlib
import json
import shutil
import threading
import time
from pathlib import Path

from ml.eval import answer_generation as gen, answer_generation_resources as resources

ROOT = gen.ROOT
OUT = ROOT / "ml/out/ml53_completion"
RESUMED = OUT / "resumed"
POLICY = {"max_memory_fraction": .80, "unloaded_model_reserve_bytes": int(3.5*1024**3),
          "max_cpu_percent_between_answers": 85, "sample_seconds": 2, "wait_seconds": 30}
SOURCES = ("ml/eval/memory_safe_completion.py", "docs/ML53_MEMORY_RECOVERY.md")


def enough_memory(total, available, loaded, policy=POLICY):
    reserve = 0 if loaded else policy["unloaded_model_reserve_bytes"]
    return available-reserve >= total*(1-policy["max_memory_fraction"])


def prepare(out=OUT, resumed=RESUMED):
    checkpoint, interruption = gen.read(out / "checkpoint.json"), gen.read(out / "memory_interruption.json")
    assert gen.sha256(gen.OUT / "answers.jsonl") == interruption["journal_sha256"]
    assert gen.sha256(gen.OUT / "generation_state.json") == interruption["state_sha256"]
    assert all(gen.sha256(ROOT / p) == h for p,h in checkpoint["protected"].items() if p not in checkpoint["authorized_mutable"])
    with (gen.OUT / "answers.jsonl").open("rb") as stream:
        prefix = stream.read(checkpoint["journal_prefix_bytes"])
    assert hashlib.sha256(prefix).hexdigest() == checkpoint["journal_prefix_sha256"]
    resumed.mkdir(exist_ok=False)
    for name in ("plan.json", "preparation.json", resources.PROFILE):
        shutil.copyfile(gen.OUT / name, resumed / name)
    (resumed / "answers.jsonl").write_bytes(prefix)
    state = gen.read(gen.OUT / "generation_state.json")
    state.pop("error_type", None)
    state.update(status="paused_between_batches", updated_at=gen.now(), completed=12, total=100,
                 journal_sha256=checkpoint["journal_prefix_sha256"])
    gen.write_new(resumed / "generation_state.json", state)
    plan = gen.load_plan(resumed)
    profile = resources.load_amendment(plan, resumed)
    assert gen.digest(plan) == checkpoint["plan_sha256"] and profile["options"] == checkpoint["options"]
    seal = {"at":gen.now(), "reason":"User explicitly resumed after closing Claude; preserve interrupted A013 attempt in original journal",
            "original_failed_journal_sha256":interruption["journal_sha256"],
            "original_failed_state_sha256":interruption["state_sha256"],
            "interruption_receipt_sha256":gen.sha256(out / "memory_interruption.json"),
            "retained_prefix_sha256":checkpoint["journal_prefix_sha256"], "retained_prefix_bytes":len(prefix),
            "sources":{p:gen.sha256(ROOT / p) for p in SOURCES}, "policy":POLICY,
            "administrative_retry_ids":["A013"], "inference_settings_changed":False}
    gen.write_new(out / "recovery.json", seal)
    return seal


class MemoryGuard:
    def __init__(self, parent_pid, out=OUT, system=None, policy=POLICY):
        if system is None:
            import psutil
            system = psutil
        self.system, self.parent_pid, self.out, self.policy = system, parent_pid, out, policy
        self.stop_event, self.emergency = threading.Event(), threading.Event()
        self.lock = threading.Lock()
        self.min_available, self.peak_fraction, self.peak_cpu = None, 0, 0
        self.priority_set = set()

    def record(self, kind, **values):
        with self.lock:
            gen.append_event(self.out / "resource_events.jsonl", {"at":gen.now(), "kind":kind, **values})

    def runners(self):
        parent = self.system.Process(self.parent_pid)
        expected = Path(parent.exe()).parent / "lib/ollama/llama-server.exe"
        result = []
        for process in parent.children(recursive=True):
            try:
                if Path(process.exe()) == expected:
                    result.append(process)
            except self.system.NoSuchProcess:
                continue
        return result

    def sample(self):
        memory = self.system.virtual_memory()
        self.min_available = min(self.min_available or memory.available, memory.available)
        fraction = 1-memory.available/memory.total
        cpu = self.system.cpu_percent(interval=None)
        self.peak_fraction, self.peak_cpu = max(self.peak_fraction, fraction), max(self.peak_cpu, cpu)
        return memory, cpu

    def ready(self):
        if self.emergency.is_set():
            raise RuntimeError("Memory guard stopped this run; no automatic retry")
        memory, cpu = self.sample()
        return enough_memory(memory.total, memory.available, bool(self.runners()), self.policy) and cpu < self.policy["max_cpu_percent_between_answers"]

    def poll(self):
        memory, cpu = self.sample()
        runners = self.runners()
        for process in runners:
            if process.pid not in self.priority_set:
                process.nice(self.system.BELOW_NORMAL_PRIORITY_CLASS)
                self.priority_set.add(process.pid)
                self.record("lower_priority", pid=process.pid)
        if 1-memory.available/memory.total > self.policy["max_memory_fraction"] and runners:
            self.emergency.set()
            self.record("memory_emergency_stop", available_bytes=memory.available, total_bytes=memory.total, cpu_percent=cpu)
            for process in runners:
                process.terminate()
        return memory, cpu

    def watch(self):
        count = 0
        while not self.stop_event.wait(self.policy["sample_seconds"]):
            try:
                memory, cpu = self.poll()
                count += 1
                if count % 15 == 0:
                    self.record("sample", available_bytes=memory.available, total_bytes=memory.total, cpu_percent=cpu)
            except Exception as error:
                self.emergency.set()
                self.record("monitor_failure", error_type=type(error).__name__)
                # Fail closed: only verified child model runners can be stopped.
                try:
                    for process in self.runners():
                        process.terminate()
                except Exception:
                    pass
                break


def unload(engine):
    response = engine.client.post("/api/generate", json={"model":gen.MODEL,"keep_alive":0,"stream":False})
    response.raise_for_status()


def run(out=OUT, resumed=RESUMED):
    import psutil
    seal = gen.read(out / "recovery.json")
    assert seal["policy"] == POLICY and all(gen.sha256(ROOT / p) == h for p,h in seal["sources"].items())
    plan = gen.load_plan(resumed)
    profile = resources.load_amendment(plan, resumed)
    engine = resources.AmendedOllama(plan, profile, resumed)
    assert engine.identity() == gen.read(out / "checkpoint.json")["prior_identity"]
    parents = [p for p in psutil.process_iter(["name","exe"]) if (p.info.get("name") or "").lower() == "ollama.exe"]
    if len(parents) != 1:
        raise ValueError("Cannot identify a unique manually started Ollama process")
    guard = MemoryGuard(parents[0].pid, out)
    worker = threading.Thread(target=guard.watch, daemon=True)
    gen.write_new(out / "recovery_started.json", {"at":gen.now(),"recovery_sha256":gen.sha256(out / "recovery.json")})
    worker.start()
    try:
        while True:
            state = gen.read(resumed / "generation_state.json")
            if state["status"] == "complete":
                break
            if not guard.ready():
                unload(engine)
                guard.record("waiting_between_answers", completed=state["completed"])
                print(f"Waiting for RAM/CPU headroom; {state['completed']}/100 answers saved.", flush=True)
                guard.stop_event.wait(POLICY["wait_seconds"])
                continue
            assert all(gen.sha256(ROOT / p) == h for p,h in seal["sources"].items())
            state = gen.execute(plan, resumed, limit=1, engine=engine)
            print(f"Checkpoint {state['completed']}/100; RAM peak {100*guard.peak_fraction:.1f}%.", flush=True)
        resources.load_amendment(plan, resumed)
        with (resumed / "answers.jsonl").open("rb") as stream:
            assert hashlib.sha256(stream.read(seal["retained_prefix_bytes"])).hexdigest() == seal["retained_prefix_sha256"]
        gen.write_new(out / "recovery_complete.json", {"at":gen.now(),"state":state,
                      "administrative_retry_ids":seal["administrative_retry_ids"],"retained_12_answer_bytes_preserved":True})
        print("All 100 answers completed. Original 12 and failed-attempt history preserved.", flush=True)
    finally:
        guard.stop_event.set()
        worker.join(timeout=5)
        unload(engine)
        gen.write_new(out / "resource_summary.json", {"at":gen.now(),"peak_memory_percent":100*guard.peak_fraction,
                      "min_available_bytes":guard.min_available,"peak_total_cpu_percent":guard.peak_cpu,
                      "emergency_stopped":guard.emergency.is_set(),"model_unload_requested":True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode",choices=("prepare","run"))
    args = parser.parse_args()
    if args.mode == "prepare":
        prepare()
        print("Memory-safe continuation prepared; original interrupted journal unchanged. No model loaded.")
    else:
        run()


if __name__ == "__main__":
    main()
