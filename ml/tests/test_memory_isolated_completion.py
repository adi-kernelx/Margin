"""Resource-only isolated continuation tests; no real model or process changes."""
import json
import subprocess
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ml.eval import memory_isolated_completion as m


def pair(item, outcome):
    return (json.dumps({'id':item,'status':'started'})+'\n'+
            json.dumps({'id':item,'status':outcome})+'\n').encode()


def test_successful_prefix_preserves_exact_bytes_and_excludes_failed_attempt():
    prefix = pair('A001','complete')+pair('A002','complete')
    assert m.successful_prefix(prefix+pair('A003','failed'),{}) == prefix


@pytest.mark.parametrize('raw',[
    b'{"id":"A001","status":"started"}\n',
    pair('A001','failed')+pair('A002','complete'),
    b'{"id":"A001","status":"started"}\n{"id":"A002","status":"complete"}\n',
    pair('A001','unknown'),
])
def test_malformed_or_unresolved_history_is_not_recovered(raw):
    with pytest.raises(ValueError):
        m.successful_prefix(raw,{})


def test_isolated_preload_reserves_four_gib_beyond_twenty_percent_headroom():
    gib=1024**3
    assert m.prior.enough_memory(16*gib,8*gib,False,m.POLICY)
    assert not m.prior.enough_memory(16*gib,7*gib,False,m.POLICY)


def fake_guard():
    return SimpleNamespace(runners=lambda:[],ready=lambda:True,
                           stop_event=threading.Event(),emergency=threading.Event(),
                           watch=lambda:None,peak_fraction=.7,min_available=4*1024**3,
                           peak_cpu=35)


def test_worker_failure_unloads_model_and_preserves_error_without_retry(tmp_path,monkeypatch):
    (tmp_path/'workers').mkdir()
    guard=fake_guard()
    monkeypatch.setattr(m,'validate',lambda out:None)
    monkeypatch.setattr(m.g,'load_plan',lambda path:{})
    monkeypatch.setattr(m.resources,'load_amendment',lambda plan,path:{})
    monkeypatch.setattr(m.g,'read',lambda path:{'status':'paused_between_batches','completed':30})
    monkeypatch.setattr(m,'parent_process',lambda system:SimpleNamespace(pid=1))
    monkeypatch.setattr(m.prior,'MemoryGuard',lambda *args,**kwargs:guard)
    engine=object()
    monkeypatch.setattr(m.resources,'AmendedOllama',lambda *args:engine)
    generate=Mock(side_effect=RuntimeError('transport failed'))
    unload=Mock()
    monkeypatch.setattr(m.g,'execute',generate)
    monkeypatch.setattr(m.prior,'unload',unload)
    with pytest.raises(RuntimeError,match='transport failed'):
        m.worker(tmp_path)
    assert generate.call_count == 1
    unload.assert_called_once_with(engine)
    summary=json.loads((tmp_path/'workers/A031/resource_summary.json').read_text())
    assert summary['model_unloaded'] and guard.stop_event.is_set()


def test_controller_stops_on_failed_worker_without_launching_a_retry(tmp_path,monkeypatch):
    monkeypatch.setattr(m,'validate',lambda out:None)
    monkeypatch.setattr(m.g,'read',lambda path:{'identity':{'model':'same'},'status':'paused_between_batches','completed':30})
    monkeypatch.setattr(m.g,'sha256',lambda path:'sealed')
    monkeypatch.setattr(m.g,'Ollama',lambda:SimpleNamespace(identity=lambda:{'model':'same'}))
    monkeypatch.setattr(m,'parent_process',lambda system:SimpleNamespace(pid=1))
    monkeypatch.setattr(m.prior,'MemoryGuard',lambda *args,**kwargs:fake_guard())
    spawn=Mock(side_effect=subprocess.CalledProcessError(1,'worker'))
    monkeypatch.setattr(m.subprocess,'run',spawn)
    with pytest.raises(subprocess.CalledProcessError):
        m.run(tmp_path)
    assert spawn.call_count == 1
    assert (tmp_path/'recovery_started.json').exists()
