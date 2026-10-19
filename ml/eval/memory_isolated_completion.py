"""Manually diagnosed resource recovery: one fresh CPU worker/model per answer."""
import argparse
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

OUT = g.ROOT / 'ml/out/ml53_isolated_completion'
PARENT = prior.OUT
RESUMED = OUT / 'resumed'
SOURCES = ('ml/eval/memory_isolated_completion.py', 'docs/ML53_ISOLATED_RECOVERY.md')
POLICY = {**prior.POLICY, 'unloaded_model_reserve_bytes': 4 * 1024**3,
          'max_cpu_percent_between_answers': 65}


def successful_prefix(raw, plan):
    """Keep complete ordered request pairs; retain the failed source untouched."""
    lines = raw.splitlines(keepends=True)
    accepted = []
    for index in range(0, len(lines), 2):
        pair = lines[index:index+2]
        if len(pair) != 2:
            raise ValueError('Unresolved attempt requires diagnosis')
        started, result = map(json.loads, pair)
        if started['status'] != 'started' or started['id'] != result['id']:
            raise ValueError('Malformed journal pair')
        if result['status'] == 'failed':
            if index + 2 != len(lines):
                raise ValueError('Failed attempt must end the preserved source journal')
            break
        if result['status'] != 'complete':
            raise ValueError('Invalid journal outcome')
        accepted.extend(pair)
    return b''.join(accepted)


def check_parent(parent=PARENT):
    checkpoint = g.read(parent / 'checkpoint.json')
    interruption = g.read(parent / 'memory_interruption.json')
    assert all(g.sha256(g.ROOT/p) == h for p,h in checkpoint['protected'].items()
               if p not in checkpoint['authorized_mutable'])
    assert g.sha256(g.OUT/'answers.jsonl') == interruption['journal_sha256']
    assert g.sha256(g.OUT/'generation_state.json') == interruption['state_sha256']
    first_seal = g.read(parent/'recovery.json')
    assert all(g.sha256(g.ROOT/p) == h for p,h in first_seal['sources'].items())
    return checkpoint


def prepare(out=OUT, parent=PARENT):
    checkpoint = check_parent(parent)
    source = parent/'resumed'
    plan = g.load_plan(source)
    state = g.read(source/'generation_state.json')
    summary = g.read(parent/'resource_summary.json')
    raw = (source/'answers.jsonl').read_bytes()
    events = [json.loads(line) for line in raw.splitlines()]
    assert state['status'] == 'failed' and state['completed'] == 30
    assert summary['emergency_stopped'] and events[-1]['status'] == 'failed' and events[-1]['id'] == 'A031'
    assert sum(e['status']=='complete' for e in events) == 30
    prefix = successful_prefix(raw, plan)
    assert hashlib.sha256(prefix[:checkpoint['journal_prefix_bytes']]).hexdigest() == checkpoint['journal_prefix_sha256']
    out.mkdir(exist_ok=False)
    resumed = out/'resumed'
    resumed.mkdir()
    for name in ('plan.json','preparation.json',resources.PROFILE):
        shutil.copyfile(source/name, resumed/name)
    (resumed/'answers.jsonl').write_bytes(prefix)
    state.pop('error_type',None)
    state.update(status='paused_between_batches',updated_at=g.now(),journal_sha256=g.sha256(resumed/'answers.jsonl'))
    g.write_new(resumed/'generation_state.json',state)
    profile = resources.load_amendment(plan,resumed)
    assert len(g.journal_answers(resumed/'answers.jsonl',plan['records'],g.digest(plan))) == 30
    protected = {str(path.relative_to(g.ROOT)).replace('\\','/'):g.sha256(path)
                 for path in (source/'answers.jsonl',source/'generation_state.json',parent/'resource_summary.json',
                              parent/'recovery.json',parent/'resource_events.jsonl')}
    seal = dict(at=g.now(),reason='Manual diagnosis after 80% memory guard stop; user authorized completion unattended',
                retained=30,retained_prefix_bytes=len(prefix),retained_prefix_sha256=hashlib.sha256(prefix).hexdigest(),
                parent_artifacts=protected,policy=POLICY,sources={p:g.sha256(g.ROOT/p) for p in SOURCES},
                administrative_retry_ids=['A013','A031'],partial_outputs_viewed=False,
                inference_settings_changed=False,options=profile['options'])
    g.write_new(out/'recovery.json',seal)
    return seal


def validate(out=OUT):
    check_parent()
    seal = g.read(out/'recovery.json')
    assert seal['policy'] == POLICY
    assert all(g.sha256(g.ROOT/p)==h for p,h in {**seal['sources'],**seal['parent_artifacts']}.items())
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
    profile = resources.load_amendment(plan,resumed)
    before = g.read(resumed/'generation_state.json')
    assert before['status'] == 'paused_between_batches' and before['completed'] < 100
    item = f"A{before['completed']+1:03d}"
    target = out/'workers'/item
    target.mkdir(exist_ok=False)
    guard = prior.MemoryGuard(parent_process(psutil).pid,target,policy=POLICY)
    engine = resources.AmendedOllama(plan,profile,resumed)
    if guard.runners() or not guard.ready():
        raise ValueError('Worker must start with an unloaded model and sufficient headroom')
    g.write_new(target/'started.json',dict(at=g.now(),before_completed=before['completed']))
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
        command = [sys.executable,'-m','ml.eval.memory_isolated_completion','worker']
        subprocess.run(command,cwd=g.ROOT,check=True)
        state = g.read(resumed/'generation_state.json')
        memory,cpu = guard.sample()
        guard.record('worker_complete_unloaded',completed=state['completed'],available_bytes=memory.available,total_bytes=memory.total,cpu_percent=cpu)
        print(f"Fresh worker finished: {state['completed']}/100; unloaded RAM {100*(1-memory.available/memory.total):.1f}%.",flush=True)
    summaries = [g.read(path) for path in (out/'workers').glob('*/resource_summary.json')]
    assert len(summaries) == 70 and all(not r['emergency_stopped'] and r['model_unloaded'] for r in summaries)
    g.write_new(out/'resource_summary.json',dict(at=g.now(),workers=len(summaries),
                peak_memory_percent=max(r['peak_memory_percent'] for r in summaries),
                min_available_bytes=min(r['min_available_bytes'] for r in summaries),
                peak_total_cpu_percent=max(r['peak_total_cpu_percent'] for r in summaries),
                emergency_stopped=False,model_unloaded_after_every_answer=True))
    g.write_new(out/'recovery_complete.json',dict(at=g.now(),completed=100,retained=30,new_completed=70,
                administrative_retry_ids=['A013','A031'],prior_interruption_history_preserved=True))
    print('All 100 original answers completed; both interrupted journals preserved.',flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=('prepare','run','worker'))
    args = parser.parse_args()
    {'prepare':prepare,'run':run,'worker':worker}[args.mode]()


if __name__ == '__main__':
    main()
