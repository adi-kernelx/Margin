"""Four-thread/resource amendment invariants without LLM calls."""
import json
import subprocess
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ml.eval import resource_limited_completion as m


@pytest.mark.parametrize('total,allowed,expected',[
    (12,list(range(12)),[0,2,4,6,8,10]),
    (12,[2,4,6],[2,4,6]),
    (5,list(range(5)),[0,2]),
])
def test_affinity_never_exceeds_half_logical_cpus_or_expands_existing_mask(total,allowed,expected):
    result=m.cpu_budget(total,allowed)
    assert result==expected and set(result)<=set(allowed)
    assert len(result)/total<=.5


def test_single_cpu_cannot_supply_a_fifty_percent_affinity_ceiling():
    with pytest.raises(ValueError): m.cpu_budget(1,[0])


class Daemon:
    pid=1
    def __init__(self): self.mask=list(range(12))
    def cpu_affinity(self,value=None):
        if value is not None: self.mask=list(value)
        return list(self.mask)


def test_daemon_affinity_is_restored_even_after_generation_failure():
    daemon=Daemon(); guard=SimpleNamespace(record=Mock())
    with pytest.raises(RuntimeError,match='failed'):
        with m.daemon_budget(daemon,12,guard):
            assert daemon.mask==[0,2,4,6,8,10]
            raise RuntimeError('failed')
    assert daemon.mask==list(range(12))
    assert guard.record.call_args_list[-1].args[0]=='daemon_affinity_restored'


def test_resource_policy_matches_user_request_and_retains_unloaded_reserve():
    assert m.POLICY['max_memory_fraction']==.85
    assert m.POLICY['max_cpu_percent_between_answers']==50
    assert m.POLICY['unloaded_model_reserve_bytes']==4*1024**3


def test_worker_failure_unloads_and_restores_affinity_without_retry(tmp_path,monkeypatch):
    (tmp_path/'workers').mkdir()
    daemon=Daemon()
    guard=SimpleNamespace(runners=lambda:[],ready=lambda:True,record=Mock(),
                          stop_event=threading.Event(),emergency=threading.Event(),watch=lambda:None,
                          peak_fraction=.7,min_available=4*1024**3,peak_cpu=35)
    monkeypatch.setattr(m,'validate',lambda out:None)
    monkeypatch.setattr(m.g,'load_plan',lambda path:{})
    monkeypatch.setattr(m,'load_profile',lambda plan,path:{})
    monkeypatch.setattr(m.g,'read',lambda path:{'status':'paused_between_batches','completed':38})
    monkeypatch.setattr(m,'parent_process',lambda system:daemon)
    monkeypatch.setattr(m,'CpuGuard',lambda *args,**kwargs:guard)
    monkeypatch.setattr(m,'LimitedOllama',lambda *args:object())
    generate=Mock(side_effect=RuntimeError('transport failed'))
    unload=Mock()
    monkeypatch.setattr(m.g,'execute',generate)
    monkeypatch.setattr(m.prior,'unload',unload)
    with pytest.raises(RuntimeError,match='transport failed'): m.worker(tmp_path)
    assert generate.call_count==unload.call_count==1
    assert daemon.mask==list(range(12))
    assert json.loads((tmp_path/'workers/A039/resource_summary.json').read_text())['model_unloaded']


def test_changed_four_thread_profile_is_rejected_before_generation(tmp_path,monkeypatch):
    monkeypatch.setattr(m,'check_parent',lambda:None)
    seal={'policy':m.POLICY,'sources':{},'parent_artifacts':{},'four_thread_profile_sha256':'expected'}
    monkeypatch.setattr(m.g,'read',lambda path:seal)
    monkeypatch.setattr(m.g,'sha256',lambda path:'changed')
    with pytest.raises(AssertionError): m.validate(tmp_path)
