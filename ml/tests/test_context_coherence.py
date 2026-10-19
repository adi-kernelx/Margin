"""Broader TRAIN workflow checks with synthetic sources and a stub LLM."""

import copy
import json
from collections import Counter

import pytest

from ml.eval import answer_generation as gen, answer_grading as grading, context_coherence as c


def study():
    qs = []
    for doc in range(6):
        for slot in range(3):
            answerable = slot < 2
            qs.append({"qid": f"Q{doc}_{slot}", "file": f"train{doc}.pdf", "split": "train",
                       "question": "Is a marker necessary or sufficient?", "answerable": answerable,
                       "references": [{"page": 1, "quote": "SECRET GOLD"}] if answerable else [],
                       "cohort": "synthetic_unsupported" if not answerable else "previous_sentinel" if doc < 4 and slot == 0 else "fresh_answerable"})
    return {"model": gen.MODEL, "identity": {"digest": "a"*64}, "server_identity": {
                "model": gen.MODEL, "digest": "a"*64, "ollama_version": "test"},
            "options": c.OPTIONS, "system": "Fixed system", "questions": qs, "protected": {"old": "same"},
            "sources": {}, "variants": c.VARIANTS, "cached": {}, "stopping_rule": "One bounded screen"}


def contexts(q):
    return [{"text": "A marker is necessary. These conditions are not sufficient.", "page": 1, "docId": q["file"]}]


class Engine:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def identity(self):
        return study()["server_identity"]

    def answer(self, plan, item):
        self.calls.append(item["id"])
        if self.fail:
            raise TimeoutError("Synthetic failure")
        return {"answer": "PRIVATE ANSWER [1]", "first_text_seconds": 1, "done_reason": "stop", "metrics": {
            "prompt_eval_duration": 1_000_000_000, "eval_duration": 2_000_000_000, "prompt_eval_count": 20, "eval_count": 30}}


def complete(tmp_path, monkeypatch):
    data, engine = study(), Engine()
    monkeypatch.setattr(c, "protected_hashes", lambda: data["protected"])
    runtime = tmp_path / "runtime.json"
    c.execute(data, tmp_path, runtime, lambda x: c.build_plan(x, contexts), engine)
    return data, runtime, engine


def ratings(path, *, wrong_negative=False):
    packet = gen.read(path / "blind_packet.json")
    rows = [{"id": row["id"], "correctness": 0 if wrong_negative and not row["answerable"] else 2,
             "grounding": 0 if wrong_negative and not row["answerable"] else 2,
             "abstained": not row["answerable"] and not wrong_negative,
             "correct_abstention": (not wrong_negative) if not row["answerable"] else None,
             "notes": "PRIVATE NOTES"} for row in packet["records"]]
    return {"version": 1, "packet_id": packet["packet_id"], "ratings": rows}


def test_original_prompt_gold_isolation_balanced_order_and_no_input_mutation():
    data = study()
    before = copy.deepcopy(data)
    plan = c.build_plan(data, contexts)
    assert plan == c.build_plan(data, contexts) and data == before
    assert len(plan["records"]) == len({r["id"] for r in plan["records"]}) == 36
    positions = Counter()
    for start in range(0, 36, 2):
        pair = plan["records"][start:start+2]
        assert len({r["qid"] for r in pair}) == 1 and {r["method"] for r in pair} == {"full", "bounded"}
        positions[pair[0]["method"]] += 1
    assert positions == {"full": 9, "bounded": 9}
    prompt, _ = gen.prompt_modules()
    for row in plan["records"]:
        assert row["prompt"] == prompt.build_prompt(row["packet"]["question"], row["packet"]["contexts"], mode="qa")
        assert "SECRET GOLD" not in row["prompt"] and "docId" not in row["packet"]["contexts"][0]


@pytest.mark.parametrize("change", [{"docId": "test.pdf"}, {"pdfFingerprint": "test.pdf"}])
def test_wrong_or_conflicting_document_scope_fails_before_generation(change):
    with pytest.raises(ValueError, match="scoped TRAIN"):
        c.build_plan(study(), lambda q: [{**contexts(q)[0], **change}])


def test_runtime_unique_requests_retention_denominators_and_private_data_absence(tmp_path, monkeypatch):
    data, path, engine = complete(tmp_path, monkeypatch)
    result = gen.read(path)
    assert len(engine.calls) == len(set(engine.calls)) == result["answers"] == 36
    assert result["answerable_questions"] == 12 and result["unsupported_probes"] == 6
    assert result["complete_reference_questions"] == {m: 0 for m in ("raw", "full", "bounded")}
    assert result["variant_labels"] == {"full": "full_original", "bounded": "coherent_original"}
    assert result["reference_questions_lost_by_smaller_budget"] == 0
    assert all(secret not in json.dumps(result) for secret in ("PRIVATE ANSWER", "SECRET GOLD", "train0.pdf", "A001"))
    with pytest.raises(FileExistsError):
        c.execute(data, tmp_path, path, engine=engine)


def test_failed_or_uncertain_attempt_never_retried(tmp_path, monkeypatch):
    data, engine = study(), Engine(fail=True)
    monkeypatch.setattr(c, "protected_hashes", lambda: data["protected"])
    for error in (TimeoutError, ValueError):
        with pytest.raises(error):
            c.execute(data, tmp_path, tmp_path / "runtime.json", lambda x: c.build_plan(x, contexts), engine)
    assert len(engine.calls) == 1


def test_interrupted_retrieval_not_silently_repeated(tmp_path, monkeypatch):
    data = study()
    monkeypatch.setattr(c, "protected_hashes", lambda: data["protected"])
    calls = []
    def retrieve(_):
        calls.append(1)
        raise RuntimeError("Interrupted retrieval")
    with pytest.raises(RuntimeError):
        c.execute(data, tmp_path, tmp_path / "runtime.json", retrieve, Engine())
    with pytest.raises(FileExistsError):
        c.execute(data, tmp_path, tmp_path / "runtime.json", retrieve, Engine())
    assert len(calls) == 1


def test_complete_review_receipt_before_study_plan_key_and_answerability_results(tmp_path, monkeypatch):
    data, runtime, _ = complete(tmp_path, monkeypatch)
    path = tmp_path / "ratings.json"
    gen.write_new(path, ratings(tmp_path))
    def load(_):
        assert (tmp_path / "grading_receipt.json").exists()
        return data
    monkeypatch.setattr(c, "load_study", load)
    original = gen.read
    def read(p):
        if p.name in {"plan.json", "private_key.json"}:
            assert (tmp_path / "grading_receipt.json").exists()
        return original(p)
    monkeypatch.setattr(gen, "read", read)
    result = c.score_review(path, tmp_path, runtime, tmp_path / "quality.json")
    assert result["decision"] == "screen_passed_no_automatic_adoption"
    assert result["answerability"]["answerable"]["questions"] == 12
    assert result["answerability"]["unsupported"]["questions"] == 6
    assert result["cohorts"]["fresh_answerable"]["questions"] == 8
    assert not result["grading"]["human_validation"] and not result["live_defaults_changed"]


def test_incomplete_review_never_reads_condition_study_or_key(tmp_path, monkeypatch):
    complete(tmp_path, monkeypatch)
    path, values = tmp_path / "ratings.json", ratings(tmp_path)
    values["ratings"].pop()
    gen.write_new(path, values)
    monkeypatch.setattr(c, "load_study", lambda _: pytest.fail("No condition disclosure"))
    with pytest.raises(ValueError, match="Complete all"):
        c.score_review(path, tmp_path, tmp_path / "runtime.json", tmp_path / "quality.json")
    assert not (tmp_path / "grading_receipt.json").exists()


def test_shared_unsupported_error_blocks_even_without_regressions(tmp_path, monkeypatch):
    data, runtime, _ = complete(tmp_path, monkeypatch)
    monkeypatch.setattr(c, "load_study", lambda _: data)
    path = tmp_path / "ratings.json"
    gen.write_new(path, ratings(tmp_path, wrong_negative=True))
    result = c.score_review(path, tmp_path, runtime, tmp_path / "quality.json")
    assert result["unsupported_errors"] == 6 and result["decision"] == "defer_coherent_selector"
    assert all(result["metrics"][m]["regressions"] == 0 for m in ("correctness", "grounding"))


def test_metadata_tampering_and_frozen_rating_path_fail(tmp_path, monkeypatch):
    data, _, _ = complete(tmp_path, monkeypatch)
    packet, key = gen.read(tmp_path / "blind_packet.json"), gen.read(tmp_path / "private_key.json")
    key["records"][next(iter(key["records"]))]["file"] = "test.pdf"
    with pytest.raises(ValueError, match="metadata"):
        c.score(packet, key, ratings(tmp_path), data["questions"])
    monkeypatch.setattr(gen, "read", lambda _: pytest.fail("Frozen path read"))
    with pytest.raises(ValueError, match="Frozen"):
        c.score_review(gen.ROOT / "ml/eval/questions.jsonl")


def test_source_seal_changes_rejected_without_models(tmp_path, monkeypatch):
    data = study()
    native = tmp_path / "native.txt"
    native.write_text("original")
    data["sources"] = {"native.txt": gen.sha256(native)}
    gen.write_new(tmp_path / "study.json", data)
    gen.write_new(tmp_path / "preparation.json", {"study_sha256": gen.sha256(tmp_path / "study.json")})
    monkeypatch.setattr(c, "ROOT", tmp_path)
    monkeypatch.setattr(c, "protected_hashes", lambda: data["protected"])
    monkeypatch.setattr(c, "validate_train", lambda _: {})
    monkeypatch.setattr(gen, "local_model_identity", lambda: data["identity"])
    assert c.load_study(tmp_path)["options"] == c.OPTIONS
    native.write_text("changed")
    with pytest.raises(ValueError, match="sources"):
        c.load_study(tmp_path)
