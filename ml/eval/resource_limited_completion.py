"""Manually diagnosed resource recovery: fresh workers with user-requested four-thread and resource limits."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from ml.eval import answer_generation as g, answer_generation_resources as resources
from ml.eval import memory_safe_completion as prior
from ml.eval import memory_isolated_completion as isolated

OUT = g.ROOT / 'ml/out/ml53_resource_completion'
PARENT = isolated.OUT
RESUMED = OUT / 'resumed'
SOURCES = ('ml/eval/resource_limited_completion.py', 'docs/ML53_RESOURCE_AMENDMENT.md')
POLICY = {**prior.POLICY, 'unloaded_model_reserve_bytes': 4 * 1024**3,
          'max_cpu_percent_between_answers': 50, 'max_memory_fraction': .85}


def check_parent(parent=PARENT):
    isolated.validate(parent)
    receipt = g.read(parent/'controller_stopped_4threads.json')
    source = parent/'resumed'
    assert receipt['no_request_interrupted'] and receipt['completed'] == 38
    assert g.sha256(source/'answers.jsonl') == receipt['journal_sha256']
    assert g.sha256(source/'generation_state.json') == receipt['state_sha256']
    return g.read(prior.OUT/'checkpoint.json')


def prepare(out=OUT, parent=PARENT):
    check_parent(parent)
    source = parent/'resumed'
    plan = g.load_plan(source)
    profile = resources.load_amendment(plan,source)
    state = g.read(source/'generation_state.json')
    assert state['status'] == 'paused_between_batches' and state['completed'] == 38
    prefix = (source/'answers.jsonl').read_bytes()
    assert len(g.journal_answers(source/'answers.jsonl',plan['records'],g.digest(plan))) == 38
    out.mkdir(exist_ok=False)
    resumed = out/'resumed'
    resumed.mkdir()
    for name in ('plan.json','preparation.json',resources.PROFILE):
        shutil.copyfile(source/name,resumed/name)
    (resumed/'answers.jsonl').write_bytes(prefix)
    g.write_new(resumed/'generation_state.json',state)
    amendment = dict(version=1,at=g.now(),reason='User explicitly requested four threads, RAM 85%, model CPU 50%',
                     options={**profile['options'],'num_thread':4},plan_sha256=g.digest(plan),
                     base_profile_sha256=g.sha256(resumed/resources.PROFILE),
                     retained_ids=[f'A{i:03d}' for i in range(1,39)],
                     journal_prefix_bytes=len(prefix),journal_prefix_sha256=g.sha256(resumed/'answers.jsonl'))
    amendment['amendment_sha256']=g.digest(amendment)
    g.write_new(resumed/'runtime_amendment_4threads.json',amendment)
    paths=(source/'answers.jsonl',source/'generation_state.json',parent/'controller_stopped_4threads.json')
    protected={str(p.relative_to(g.ROOT)).replace('\\','/'):g.sha256(p) for p in paths}
    seal=dict(at=g.now(),retained=38,retained_prefix_bytes=len(prefix),retained_prefix_sha256=g.sha256(resumed/'answers.jsonl'),
              parent_artifacts=protected,policy=POLICY,sources={p:g.sha256(g.ROOT/p) for p in SOURCES},
              administrative_retry_ids=['A013','A031'],inference_changes=['num_thread: 3 to 4 after A038'],
              additional_generation_failure=False,options=amendment['options'],
              four_thread_profile_sha256=g.sha256(resumed/'runtime_amendment_4threads.json'))
    g.write_new(out/'recovery.json',seal)
    return seal


def load_profile(plan,out=RESUMED):
    profile=g.read(out/'runtime_amendment_4threads.json')
    unsigned={k:v for k,v in profile.items() if k!='amendment_sha256'}
    assert g.digest(unsigned)==profile['amendment_sha256']
    assert profile['plan_sha256']==g.digest(plan)
    assert profile['base_profile_sha256']==g.sha256(out/resources.PROFILE)
    assert profile['options']=={**plan['options'],'num_thread':4}
    with (out/'answers.jsonl').open('rb') as stream:
        assert hashlib.sha256(stream.read(profile['journal_prefix_bytes'])).hexdigest()==profile['journal_prefix_sha256']
    answers=g.journal_answers(out/'answers.jsonl',plan['records'],g.digest(plan))
    retained=set(profile['retained_ids'])
    assert retained=={f'A{i:03d}' for i in range(1,39)}
    for item,event in answers.items():
        if item not in retained:
            assert event.get('runtime_options')==profile['options']
            assert event.get('runtime_amendment_sha256')==profile['amendment_sha256']
    return profile


class LimitedOllama(g.Ollama):
    def __init__(self,plan,profile,out):
        super().__init__()
        self.plan_hash,self.profile,self.out=g.digest(plan),profile,out
        self.profile_hash=g.sha256(out/'runtime_amendment_4threads.json')

    def identity(self):
        assert g.sha256(self.out/'runtime_amendment_4threads.json')==self.profile_hash
        return super().identity()

    def answer(self,plan,record):
        assert g.digest(plan)==self.plan_hash
        result=super().answer({**plan,'options':self.profile['options']},record)
        return {**result,'runtime_options':self.profile['options'],
                'runtime_amendment_sha256':self.profile['amendment_sha256']}


def cpu_budget(total,allowed):
    if total<2 or not allowed:
        raise ValueError('CPU affinity cannot provide a 50% ceiling on this system')
    count=min(len(allowed),total//2)
    return [allowed[i*len(allowed)//count] for i in range(count)]


@contextmanager
def daemon_budget(process,total,guard):
    original=process.cpu_affinity()
    limited=cpu_budget(total,original)
    process.cpu_affinity(limited)
    try:
        assert sorted(process.cpu_affinity())==sorted(limited)
        guard.record('cpu_budget_applied',cpus=limited,total_logical_cpus=total,
                     model_cpu_ceiling_percent=100*len(limited)/total)
        yield
    finally:
        process.cpu_affinity(original)
        guard.record('daemon_affinity_restored',cpus=original)


class CpuGuard(prior.MemoryGuard):
    def poll(self):
        parent=self.system.Process(self.parent_pid)
        expected=parent.cpu_affinity()
        for runner in self.runners():
            if set(runner.cpu_affinity())!=set(expected):
                runner.cpu_affinity(expected)
            if set(runner.cpu_affinity())!=set(expected):
                raise RuntimeError('Model CPU affinity budget not enforced')
        return super().poll()


def validate(out=OUT):
    check_parent()
    seal = g.read(out/'recovery.json')
    assert seal['policy'] == POLICY
    assert all(g.sha256(g.ROOT/p)==h for p,h in {**seal['sources'],**seal['parent_artifacts']}.items())
    assert g.sha256(out/'resumed/runtime_amendment_4threads.json') == seal['four_thread_profile_sha256']
    with (out/'resumed/answers.jsonl').open('rb') as stream:
        assert hashlib.sha256(stream.read(seal['retained_prefix_bytes'])).hexdigest() == seal['retained_prefix_sha256']
    return seal


def parent_process(system):
    parents = [p for p in system.process_iter(['name','exe']) if (p.info.get('name') or '').lower() == 'ollama.exe']
    if len(parents) != 1:
        raise ValueError('Need a unique manually started Ollama process')
    return parents[0]


def worker(out=OUT):
    import psutil
    validate(out)
    resumed = out/'resumed'
    plan = g.load_plan(resumed)
    profile = load_profile(plan,resumed)
    before = g.read(resumed/'generation_state.json')
    assert before['status'] == 'paused_between_batches' and before['completed'] < 100
    item = f"A{before['completed']+1:03d}"
    target = out/'workers'/item
    target.mkdir(exist_ok=False)
    daemon=parent_process(psutil)
    guard = CpuGuard(daemon.pid,target,policy=POLICY)
    engine = LimitedOllama(plan,profile,resumed)
    if guard.runners() or not guard.ready():
        raise ValueError('Worker must start with an unloaded model and sufficient headroom')
    g.write_new(target/'started.json',dict(at=g.now(),before_completed=before['completed']))
    with daemon_budget(daemon,psutil.cpu_count(),guard):
        watcher = threading.Thread(target=guard.watch,daemon=True)
        watcher.start()
        try:
            state = g.execute(plan,resumed,limit=1,engine=engine)
            assert state['completed'] == before['completed']+1
            if guard.emergency.is_set():
                raise RuntimeError('Guard stopped isolated worker; manual diagnosis required')
        finally:
            guard.stop_event.set()
            watcher.join(timeout=5)
            prior.unload(engine)
            deadline = time.monotonic()+30
            while guard.runners() and time.monotonic()<deadline:
                time.sleep(.5)
            unloaded = not guard.runners()
            g.write_new(target/'resource_summary.json',dict(at=g.now(),peak_memory_percent=100*guard.peak_fraction,
                        min_available_bytes=guard.min_available,peak_total_cpu_percent=guard.peak_cpu,
                        emergency_stopped=guard.emergency.is_set(),model_unloaded=unloaded))
            if not unloaded:
                raise RuntimeError('Model runner did not exit after prompt-free unload')


def run(out=OUT):
    import psutil
    validate(out)
    resumed = out/'resumed'
    engine = g.Ollama()
    expected = g.read(resumed/'generation_state.json')['identity']
    assert engine.identity() == expected
    guard = prior.MemoryGuard(parent_process(psutil).pid,out,policy=POLICY)
    if guard.runners():
        raise ValueError('Model must be unloaded before isolated continuation')
    g.write_new(out/'recovery_started.json',dict(at=g.now(),recovery_sha256=g.sha256(out/'recovery.json')))
    (out/'workers').mkdir(exist_ok=False)
    while True:
        validate(out)
        state = g.read(resumed/'generation_state.json')
        if state['status'] == 'complete':
            break
        if state['status'] != 'paused_between_batches':
            raise ValueError('Failed or uncertain worker requires manual diagnosis; no automatic retry')
        if not guard.ready():
            memory,cpu = guard.sample()
            guard.record('waiting_unloaded',completed=state['completed'],available_bytes=memory.available,total_bytes=memory.total,cpu_percent=cpu)
            print(f"Waiting unloaded for RAM/CPU headroom; {state['completed']}/100 saved.",flush=True)
            time.sleep(POLICY['wait_seconds'])
            continue
        assert engine.identity() == expected
        command = [sys.executable,'-m','ml.eval.resource_limited_completion','worker']
        subprocess.run(command,cwd=g.ROOT,check=True)
        state = g.read(resumed/'generation_state.json')
        memory,cpu = guard.sample()
        guard.record('worker_complete_unloaded',completed=state['completed'],available_bytes=memory.available,total_bytes=memory.total,cpu_percent=cpu)
        print(f"Fresh worker finished: {state['completed']}/100; unloaded RAM {100*(1-memory.available/memory.total):.1f}%.",flush=True)
    summaries = [g.read(path) for path in (out/'workers').glob('*/resource_summary.json')]
    assert len(summaries) == 62 and all(not r['emergency_stopped'] and r['model_unloaded'] for r in summaries)
    g.write_new(out/'resource_summary.json',dict(at=g.now(),workers=len(summaries),
                peak_memory_percent=max(r['peak_memory_percent'] for r in summaries),
                min_available_bytes=min(r['min_available_bytes'] for r in summaries),
                peak_total_cpu_percent=max(r['peak_total_cpu_percent'] for r in summaries),
                emergency_stopped=False,model_unloaded_after_every_answer=True,model_cpu_ceiling_percent=50,ram_stop_percent=85))
    g.write_new(out/'recovery_complete.json',dict(at=g.now(),completed=100,retained=38,new_completed=62,
                administrative_retry_ids=['A013','A031'],prior_interruption_history_preserved=True))
    print('All 100 original answers completed; both interrupted journals preserved.',flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=('prepare','run','worker'))
    args = parser.parse_args()
    {'prepare':prepare,'run':run,'worker':worker}[args.mode]()


if __name__ == '__main__':
    main()
