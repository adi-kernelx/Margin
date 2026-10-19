"""Cached three-way runner/scoring checks with synthetic data and a stub LLM."""

import copy
import json
from collections import Counter

import pytest

from ml.eval import answer_generation as gen, context_refinement as r
from ml.tests.test_context_factorial import plan as prior_plan


def plan(negatives=True):
    prior = prior_plan(negatives)
    records, evidence = r.build_records(prior)
    return {**prior, "records": records, "evidence": evidence, "methods": r.METHODS, "comparisons": r.COMPARISONS,
            "sources": {}, "protected": {"prior": "same"}}


def test_all_three_conditions_use_original_prompt_and_exact_cached_comparators():
    prior = prior_plan()
    before = copy.deepcopy(prior)
    records, evidence = r.build_records(prior)
    assert (records, evidence) == r.build_records(prior) and prior == before
    assert len(records) == len({x["id"] for x in records}) == 30
    source = {(x["qid"], x["method"]): x for x in prior["records"]}
    for x in records:
        assert "CONTEXT FROM DOCUMENT" in x["prompt"] and "SOURCE EXCERPTS" not in x["prompt"]
        assert "SECRET GOLD" not in x["prompt"]
        if x["method"] in ("full_original", "previous_original"):
            previous = "full_original" if x["method"] == "full_original" else "selected_original"
            assert x["packet"] == source[x["qid"], previous]["packet"]
            assert x["prompt"] == source[x["qid"], previous]["prompt"]
        else:
            assert len(x["packet"]["contexts"]) <= 4
            assert sum(len(c["text"].encode()) for c in x["packet"]["contexts"]) <= 4000


def test_counterbalanced_three_condition_positions_and_complete_question_blocks():
    records = plan()["records"]
    counts = {m: Counter() for m in r.METHODS}
    for start in range(0, 30, 3):
        block = records[start:start+3]
        assert len({x["qid"] for x in block}) == 1 and {x["method"] for x in block} == set(r.METHODS)
        for position, x in enumerate(block):
            counts[x["method"]][position] += 1
    assert all(sorted(c.values()) == [3, 3, 4] for c in counts.values())


@pytest.mark.parametrize("field", ["file", "prompt", "answer_quote"])
def test_cached_corruption_is_rejected_before_prompt_build(field):
    data = prior_plan()
    x = next(x for x in data["records"] if x["method"] == "full_original")
    if field == "answer_quote":
        x["packet"][field] = "Changed"
    else:
        x[field] = "Changed"
    with pytest.raises(ValueError):
        r.build_records(data)


class Engine:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def identity(self):
        return prior_plan()["server_identity"]

    def answer(self, data, item):
        self.calls.append(item["id"])
        if self.fail:
            raise TimeoutError("synthetic")
        return {"answer": "PRIVATE ANSWER [1]", "first_text_seconds": 1, "done_reason": "stop",
                "metrics": {"prompt_eval_duration": 1_000_000_000, "eval_duration": 2_000_000_000,
                            "prompt_eval_count": 20, "eval_count": 30}}


def test_runtime_three_way_aggregation_no_gold_or_negatives_in_retention_counts(tmp_path, monkeypatch):
    monkeypatch.setattr(r, "protected_hashes", lambda: {"prior": "same"})
    engine = Engine()
    result = r.execute(plan(), tmp_path, tmp_path / "runtime.json", engine)
    assert result["answers"] == len(engine.calls) == len(set(engine.calls)) == 30
    assert result["answerable_questions"] == 8 and result["unsupported_probes"] == 2
    assert result["complete_reference_questions"] == {m: 0 for m in r.METHODS}
    assert result["additional_reference_losses"] == {m: 0 for m in r.METHODS[1:]}
    assert set(result["timing"]) == set(r.METHODS)
    for secret in ("PRIVATE ANSWER", "SECRET GOLD", "A001", "train0.pdf"):
        assert secret not in json.dumps(result)
    with pytest.raises(FileExistsError):
        r.execute(plan(), tmp_path, tmp_path / "runtime.json", engine)


def test_protected_changes_and_failed_attempt_stop_without_retries(tmp_path, monkeypatch):
    data, engine = plan(), Engine(fail=True)
    monkeypatch.setattr(r, "protected_hashes", lambda: {"prior": "changed"})
    with pytest.raises(ValueError, match="Protected"):
        r.execute(data, tmp_path, tmp_path / "runtime.json", engine)
    assert not engine.calls
    monkeypatch.setattr(r, "protected_hashes", lambda: {"prior": "same"})
    with pytest.raises(TimeoutError):
        r.execute(data, tmp_path, tmp_path / "runtime.json", engine)
    with pytest.raises(ValueError, match="manual diagnosis"):
        r.execute(data, tmp_path, tmp_path / "runtime.json", engine)
    assert len(engine.calls) == 1


def rated(data):
    from ml.eval.answer_grading import packet_from_answers
    packet, key = packet_from_answers(data, {x["id"]: {"answer": "PRIVATE ANSWER [1]"} for x in data["records"]})
    values = {"full_original": 2, "previous_original": 1, "refined_original": 2}
    ratings = {"version": 1, "packet_id": packet["packet_id"], "ratings": [
        {"id": x["id"], "correctness": values[x["method"]], "grounding": values[x["method"]],
         "abstained": False, "correct_abstention": None, "notes": "PRIVATE NOTES"} for x in data["records"]]}
    return packet, key, ratings


def test_paired_refinement_effects_require_complete_valid_three_way_blocks():
    data = plan(False)
    packet, key, ratings = rated(data)
    result = r.score(packet, key, ratings, data["questions"])
    for metric in ("correctness", "grounding"):
        assert result["metrics"][metric]["comparisons"]["refined_vs_full"]["value"] == 0
        assert result["metrics"][metric]["comparisons"]["refined_vs_previous"]["value"] == 1
        assert result["metrics"][metric]["comparisons"]["previous_vs_full"]["regressions"] == 10
    assert "PRIVATE" not in json.dumps(result) and not result["live_defaults_changed"]
    with pytest.raises(ValueError, match="Complete all"):
        r.score(packet, key, {**ratings, "ratings": ratings["ratings"][:-1]}, data["questions"])
    bad = copy.deepcopy(key)
    bad["records"][next(iter(bad["records"]))]["file"] = "frozen.pdf"
    with pytest.raises(ValueError, match="metadata"):
        r.score(packet, bad, ratings, data["questions"])


def test_review_receipt_precedes_plan_key_and_reports_gate(tmp_path, monkeypatch):
    monkeypatch.setattr(r, "protected_hashes", lambda: {"prior": "same"})
    data = plan(False)
    runtime, report = tmp_path / "runtime.json", tmp_path / "quality.json"
    r.execute(data, tmp_path, runtime, Engine())
    packet, key, ratings = rated(data)
    path = tmp_path / "ratings.json"
    gen.write_new(path, ratings)
    def load(_):
        assert (tmp_path / "grading_receipt.json").exists()
        return data
    monkeypatch.setattr(r, "load_plan", load)
    original = gen.read
    def read(path):
        if path.name == "private_key.json":
            assert (tmp_path / "grading_receipt.json").exists()
        return original(path)
    monkeypatch.setattr(gen, "read", read)
    output = r.score_review(path, tmp_path, runtime, report)
    assert output["decision"] == "screen_passed_further_validation_required"
    assert output["grading"]["ratings_count"] == 30 and not output["grading"]["human_validation"]


def test_incomplete_review_never_opens_plan_or_key(tmp_path, monkeypatch):
    monkeypatch.setattr(r, "protected_hashes", lambda: {"prior": "same"})
    r.execute(plan(), tmp_path, tmp_path / "runtime.json", Engine())
    packet = gen.read(tmp_path / "blind_packet.json")
    path = tmp_path / "ratings.json"
    gen.write_new(path, {"version": 1, "packet_id": packet["packet_id"], "ratings": []})
    monkeypatch.setattr(r, "load_plan", lambda _: pytest.fail("No condition disclosure"))
    with pytest.raises(ValueError, match="Complete all"):
        r.score_review(path, tmp_path, tmp_path / "runtime.json", tmp_path / "quality.json")
    assert not (tmp_path / "grading_receipt.json").exists()


def test_source_tampering_and_frozen_rating_input_fail_without_models(tmp_path, monkeypatch):
    data = plan()
    source = tmp_path / "source.py"
    source.write_text("original")
    data["sources"] = {"source.py": gen.sha256(source)}
    gen.write_new(tmp_path / "plan.json", data)
    gen.write_new(tmp_path / "preparation.json", {"plan_sha256": gen.sha256(tmp_path / "plan.json")})
    monkeypatch.setattr(r, "ROOT", tmp_path)
    monkeypatch.setattr(r, "protected_hashes", lambda: {"prior": "same"})
    monkeypatch.setattr(gen, "local_model_identity", lambda: data["identity"])
    assert len(r.load_plan(tmp_path)["records"]) == 30
    source.write_text("changed")
    with pytest.raises(ValueError, match="source"):
        r.load_plan(tmp_path)
    with pytest.raises(ValueError, match="Frozen"):
        r.score_review(gen.ROOT / "ml/eval/questions.jsonl")


def test_unsupported_error_blocks_acceptance_even_without_paired_regression(tmp_path, monkeypatch):
    monkeypatch.setattr(r, "protected_hashes", lambda: {"prior": "same"})
    data, runtime = plan(), tmp_path / "runtime.json"
    r.execute(data, tmp_path, runtime, Engine())
    packet = gen.read(tmp_path / "blind_packet.json")
    ratings = {"version": 1, "packet_id": packet["packet_id"], "ratings": [
        {"id": x["id"], "correctness": 2 if x["answerable"] else 0, "grounding": 2 if x["answerable"] else 0,
         "abstained": False, "correct_abstention": None if x["answerable"] else False, "notes": ""} for x in packet["records"]]}
    path = tmp_path / "ratings.json"
    gen.write_new(path, ratings)
    monkeypatch.setattr(r, "load_plan", lambda _: data)
    output = r.score_review(path, tmp_path, runtime, tmp_path / "quality.json")
    assert output["unsupported_errors"] == 2 and output["decision"] == "hold_refinement"
    assert not any(v for counts in output["regressions"].values() for v in counts.values())
