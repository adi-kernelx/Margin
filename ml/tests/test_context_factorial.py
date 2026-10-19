"""Four-condition diagnostic guardrails, with synthetic inputs and stubbed LLM."""

import copy
import json
from collections import Counter

import pytest

from ml.eval import answer_generation as gen, context_factorial as f, grounded_prompt


def fixture(negatives=True):
    study = {"model": gen.MODEL, "identity": {"digest": "a"*64}, "system": "fixed system",
             "server_identity": {"model": gen.MODEL, "digest": "a"*64, "ollama_version": "test"},
             "questions": [{"qid": f"Q{i:03d}", "file": f"train{i%4}.pdf", "split": "train",
                            "question": f"What boundary applies in case {i}?", "answerable": not negatives or i < 8,
                            "references": [{"quote": "SECRET GOLD", "page": 1}] if not negatives or i < 8 else [],
                            "cohort": "synthetic_unsupported" if negatives and i >= 8 else "previous_development"} for i in range(10)]}
    original, _ = gen.prompt_modules()
    records = []
    for q in study["questions"]:
        full = [{"text": "A boundary separates classes.", "page": 1}, {"text": "Other source text.", "page": 2}]
        for method in ("full", "bounded"):
            contexts = full if method == "full" else full[:1]
            packet = {"question": q["question"], "source_file": q["file"], "answerable": q["answerable"],
                      "answer_quote": "SECRET GOLD" if q["answerable"] else "", "answer_pages": [1] if q["answerable"] else [],
                      "contexts": contexts}
            prompt = original.build_prompt(q["question"], contexts, mode="qa") if method == "full" else grounded_prompt.build_prompt(q["question"], contexts)
            records.append({"qid": q["qid"], "set": "train", "file": q["file"], "method": method, "packet": packet, "prompt": prompt})
    return study, {"records": records}


def plan(negatives=True):
    study, prior = fixture(negatives)
    records, evidence = f.build_records(study, prior)
    return {"version": 1, "model": gen.MODEL, "identity": study["identity"], "model_digest": "a"*64,
            "server_identity": study["server_identity"], "system": study["system"], "options": f.OPTIONS,
            "questions": study["questions"], "records": records, "evidence": evidence, "protected": {"prior": "same"},
            "methods": f.METHODS, "contrasts": f.CONTRASTS, "sources": {}}


def test_factorial_uses_exact_cached_text_and_four_prompt_context_combinations():
    study, prior = fixture()
    before = copy.deepcopy(prior)
    records, evidence = f.build_records(study, prior)
    assert (records, evidence) == f.build_records(study, prior)
    assert len(records) == len({r["id"] for r in records}) == 40
    assert prior == before
    cached = {(r["qid"], r["method"]): r for r in prior["records"]}
    for r in records:
        packing, prompting = f.METHODS[r["method"]]
        assert r["packet"] == cached[r["qid"], packing]["packet"]
        assert "SECRET GOLD" not in r["prompt"]
        assert ("SOURCE EXCERPTS" in r["prompt"]) == (prompting == "grounded")
        assert ("CONTEXT FROM DOCUMENT" in r["prompt"]) == (prompting == "original")
        if r["method"] in ("full_original", "selected_grounded"):
            assert r["prompt"] == cached[r["qid"], packing]["prompt"]
    # Returned records are independent copies, not aliases into old checkpoints.
    records[0]["packet"]["contexts"][0]["text"] = "Changed"
    assert prior == before


def test_ten_counterbalanced_blocks_have_each_method_once_and_balanced_positions():
    records = plan()["records"]
    positions = {method: Counter() for method in f.METHODS}
    for offset in range(0, 40, 4):
        block = records[offset:offset+4]
        assert len({r["qid"] for r in block}) == 1
        assert {r["method"] for r in block} == set(f.METHODS)
        for pos, r in enumerate(block):
            positions[r["method"]][pos] += 1
    assert all(sorted(counts.values()) == [2, 2, 3, 3] for counts in positions.values())


@pytest.mark.parametrize("change", ["scope", "reference", "prompt", "duplicate", "missing", "budget"])
def test_cached_pair_corruption_is_rejected(change):
    study, prior = fixture()
    r = prior["records"][0]
    if change == "scope":
        r["file"] = "frozen.pdf"
    elif change == "reference":
        r["packet"]["answer_quote"] = "Changed"
    elif change == "prompt":
        r["prompt"] = "Changed"
    elif change == "duplicate":
        prior["records"].append(copy.deepcopy(r))
    elif change == "missing":
        prior["records"].pop()
    else:
        r["packet"]["contexts"][0]["text"] = "x"*18001
    with pytest.raises(ValueError):
        f.build_records(study, prior)


class Engine:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def identity(self):
        return fixture()[0]["server_identity"]

    def answer(self, data, record):
        self.calls.append(record["id"])
        if self.fail:
            raise TimeoutError("synthetic")
        return {"answer": "PRIVATE ANSWER [1]", "first_text_seconds": 1., "done_reason": "stop",
                "metrics": {"prompt_eval_duration": 1_000_000_000, "eval_duration": 2_000_000_000,
                            "prompt_eval_count": 20, "eval_count": 30}}


def test_four_way_runtime_is_aggregate_only_and_excludes_empty_negative_references(tmp_path, monkeypatch):
    monkeypatch.setattr(f, "protected_hashes", lambda: {"prior": "same"})
    engine = Engine()
    output = f.execute(plan(), tmp_path, tmp_path / "runtime.json", engine)
    assert output["answers"] == len(engine.calls) == len(set(engine.calls)) == 40
    assert output["answerable_questions"] == 8 and output["unsupported_probes"] == 2
    assert output["complete_reference_questions"] == {"full": 0, "bounded": 0}
    assert all(v["requests"] == 10 for v in output["timing"].values())
    for secret in ("PRIVATE ANSWER", "SECRET GOLD", "A001", "train0.pdf"):
        assert secret not in json.dumps(output)
    packet, key = gen.read(tmp_path / "blind_packet.json"), gen.read(tmp_path / "private_key.json")
    assert len(packet["records"]) == 40 and {m["method"] for m in key["records"].values()} == set(f.METHODS)
    assert all("method" not in r and "qid" not in r for r in packet["records"])
    with pytest.raises(FileExistsError):
        f.execute(plan(), tmp_path, tmp_path / "runtime.json", engine)


def test_protected_changes_block_generation_and_failed_attempts_are_never_retried(tmp_path, monkeypatch):
    engine, data = Engine(fail=True), plan()
    monkeypatch.setattr(f, "protected_hashes", lambda: {"prior": "changed"})
    with pytest.raises(ValueError, match="Protected"):
        f.execute(data, tmp_path, tmp_path / "runtime.json", engine)
    assert not engine.calls
    monkeypatch.setattr(f, "protected_hashes", lambda: {"prior": "same"})
    with pytest.raises(TimeoutError):
        f.execute(data, tmp_path, tmp_path / "runtime.json", engine)
    with pytest.raises(ValueError, match="manual diagnosis"):
        f.execute(data, tmp_path, tmp_path / "runtime.json", engine)
    assert len(engine.calls) == 1 and not (tmp_path / "blind_packet.json").exists()


def rated(data):
    packet, key = grading_packet(data)
    scores = {"full_original": 1, "full_grounded": 2, "selected_original": 0, "selected_grounded": 1}
    ratings = {"version": 1, "packet_id": packet["packet_id"], "ratings": [
        {"id": r["id"], "correctness": scores[r["method"]], "grounding": scores[r["method"]],
         "abstained": False, "correct_abstention": None, "notes": "PRIVATE NOTES"} for r in data["records"]]}
    return packet, key, ratings


def grading_packet(data):
    from ml.eval.answer_grading import packet_from_answers
    return packet_from_answers(data, {r["id"]: {"answer": "PRIVATE ANSWER"} for r in data["records"]})


def test_factor_main_effects_conditional_effects_and_interaction_are_paired_by_question():
    data = plan(negatives=False)
    packet, key, ratings = rated(data)
    output = f.score(packet, key, ratings, data["questions"])
    for metric in ("correctness", "grounding"):
        effects = output["metrics"][metric]["effects"]
        assert effects["packing_main_effect"]["value"] == -1
        assert effects["prompt_main_effect"]["value"] == 1
        assert effects["interaction"]["value"] == 0
        assert effects["packing_at_original_prompt"]["regressions"] == 10
        assert effects["prompt_at_selected_context"]["value"] == 1
        assert effects["combined_vs_full_original"]["value"] == 0
    assert output["candidate_checks"]["selected_original"]["regressions_against_full_original"]["correctness"] == 10
    assert not output["live_defaults_changed"] and "PRIVATE" not in json.dumps(output)
    with pytest.raises(ValueError, match="Complete all"):
        f.score(packet, key, {**ratings, "ratings": ratings["ratings"][:-1]}, data["questions"])
    bad = copy.deepcopy(key)
    bad["records"][next(iter(bad["records"]))]["file"] = "frozen.pdf"
    with pytest.raises(ValueError, match="metadata"):
        f.score(packet, bad, ratings, data["questions"])


def test_interaction_detects_opposite_prompt_effects():
    data = plan(negatives=False)
    packet, key, ratings = rated(data)
    for r in ratings["ratings"]:
        method = key["records"][r["id"]]["method"]
        value = {"full_original": 1, "full_grounded": 2, "selected_original": 1, "selected_grounded": 0}[method]
        r.update(correctness=value, grounding=value)
    result = f.score(packet, key, ratings, data["questions"])
    assert result["metrics"]["grounding"]["effects"]["interaction"]["value"] == -2
    assert result["metrics"]["grounding"]["effects"]["prompt_main_effect"]["value"] == 0


def test_plan_hash_and_source_tampering_stop_work_before_models(tmp_path, monkeypatch):
    data = plan()
    source = tmp_path / "source.py"
    source.write_text("original")
    data["sources"] = {"source.py": gen.sha256(source)}
    gen.write_new(tmp_path / "plan.json", data)
    gen.write_new(tmp_path / "preparation.json", {"plan_sha256": gen.sha256(tmp_path / "plan.json")})
    monkeypatch.setattr(f, "ROOT", tmp_path)
    monkeypatch.setattr(f, "protected_hashes", lambda: {"prior": "same"})
    monkeypatch.setattr(gen, "local_model_identity", lambda: data["identity"])
    assert len(f.load_plan(tmp_path)["records"]) == 40
    source.write_text("changed")
    with pytest.raises(ValueError, match="source"):
        f.load_plan(tmp_path)


def test_complete_ratings_are_sealed_before_plan_and_key_access(tmp_path, monkeypatch):
    data = plan(negatives=False)
    monkeypatch.setattr(f, "protected_hashes", lambda: {"prior": "same"})
    runtime = tmp_path / "runtime.json"
    f.execute(data, tmp_path, runtime, Engine())
    packet, key, ratings = rated(data)
    # Scoring the generated packet requires its actual answer-based identity.
    actual = gen.read(tmp_path / "blind_packet.json")
    ratings["packet_id"] = actual["packet_id"]
    path = tmp_path / "ratings.json"
    gen.write_new(path, ratings)
    def load(_):
        assert (tmp_path / "grading_receipt.json").exists()
        return data
    monkeypatch.setattr(f, "load_plan", load)
    original_read = gen.read
    def read(path):
        if path.name == "private_key.json":
            assert (tmp_path / "grading_receipt.json").exists()
        return original_read(path)
    monkeypatch.setattr(gen, "read", read)
    output = f.score_review(path, tmp_path, runtime, tmp_path / "quality.json")
    assert output["candidate_checks"]["selected_original"]["status"] == "hold"
    assert output["candidate_checks"]["full_grounded"]["status"] == "passes_small_screen_only"
    assert output["grading"]["ratings_count"] == 40 and not output["grading"]["human_validation"]


def test_incomplete_ratings_do_not_reveal_plan_or_key(tmp_path, monkeypatch):
    monkeypatch.setattr(f, "protected_hashes", lambda: {"prior": "same"})
    f.execute(plan(), tmp_path, tmp_path / "runtime.json", Engine())
    packet = gen.read(tmp_path / "blind_packet.json")
    path = tmp_path / "ratings.json"
    gen.write_new(path, {"version": 1, "packet_id": packet["packet_id"], "ratings": []})
    monkeypatch.setattr(f, "load_plan", lambda _: pytest.fail("No plan read during incomplete grading"))
    with pytest.raises(ValueError, match="Complete all"):
        f.score_review(path, tmp_path, tmp_path / "runtime.json", tmp_path / "quality.json")
    assert not (tmp_path / "grading_receipt.json").exists()


def test_frozen_ratings_path_rejected_before_reads(monkeypatch):
    monkeypatch.setattr(gen, "read", lambda _: pytest.fail("No frozen reads"))
    with pytest.raises(ValueError, match="Frozen"):
        f.score_review(f.ROOT / "ml/eval/questions.jsonl")


def test_unsupported_errors_are_counted_per_condition():
    data = plan()
    packet, key = grading_packet(data)
    ratings = {"version": 1, "packet_id": packet["packet_id"], "ratings": [
        {"id": r["id"], "correctness": 2, "grounding": 2, "abstained": not r["packet"]["answerable"],
         "correct_abstention": None if r["packet"]["answerable"] else True, "notes": ""} for r in data["records"]]}
    target = next(r["id"] for r in data["records"] if not r["packet"]["answerable"] and r["method"] == "selected_original")
    next(r for r in ratings["ratings"] if r["id"] == target).update(correctness=0, grounding=0, abstained=False, correct_abstention=False)
    result = f.score(packet, key, ratings, data["questions"])
    assert result["candidate_checks"]["selected_original"]["unsupported_errors"] == 1
    assert result["correct_abstention"]["selected_original"]["value"] == .5
    assert result["correct_abstention"]["selected_grounded"]["value"] == 1


def test_train_membership_gate_precedes_cached_plan_access(tmp_path, monkeypatch):
    study, _ = fixture()
    for q in study["questions"]:
        if q["file"] == "train0.pdf":
            q["file"] = "frozen.pdf"
    root = tmp_path / "ml/models/artifacts/ml5"
    root.mkdir(parents=True)
    gen.write_new(root / "protocol.json", {"train_files": ["train1.pdf", "train2.pdf", "train3.pdf"]})
    monkeypatch.setattr(f, "ROOT", tmp_path)
    monkeypatch.setattr(f, "protected_hashes", lambda: {"prior": "same"})
    monkeypatch.setattr(f.revision, "load_study", lambda: study)
    original_read = gen.read
    def read(path):
        assert path.name == "protocol.json", "No cached input should be opened after a failed TRAIN gate"
        return original_read(path)
    monkeypatch.setattr(gen, "read", read)
    with pytest.raises(ValueError, match="sealed TRAIN"):
        f.prepare(tmp_path / "output")
