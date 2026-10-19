"""TRAIN quality screen guardrails and blind scoring use synthetic data only."""

import copy
import json

import pytest

from ml.eval import answer_generation as gen, context_quality as quality, llm_latency as latency


def study():
    return {"model": gen.MODEL, "identity": {"digest": "a"*64}, "options": quality.OPTIONS,
            "server_identity": {"model": gen.MODEL, "digest": "a"*64, "ollama_version": "test"},
            "system": "frozen system", "variants": latency.VARIANTS, "protected": {"frozen": "unchanged"},
            "questions": [{"qid": f"Q{i:03d}", "file": f"train{i}.pdf", "question": "Fresh source question",
                           "references": [{"quote": "SECRET GOLD", "page": 4}], "split": "train", "answerable": True}
                          for i in range(2)]}


def contexts(q):
    return [{"text": ("source context "*1500 if i == 0 else "SECRET GOLD"), "page": i+1,
             "pdfFingerprint": q["file"], "kind": "passage", "relevance_score": 5.} for i in range(4)]


def prepared():
    data = study()
    prompt, _ = gen.prompt_modules()
    return data, quality.build_plan(data, contexts, prompt.build_prompt)


def test_retrieval_pair_keeps_order_and_records_evidence_loss_without_injecting_gold():
    data, plan = prepared()
    assert len(plan["records"]) == 4 and len({r["id"] for r in plan["records"]}) == 4
    assert plan == quality.build_plan(data, contexts, gen.prompt_modules()[0].build_prompt)
    assert all(e["raw"] == [True] and e["bounded"] == [False] for e in plan["evidence"])
    assert all(not {"relevance_score", "pdfFingerprint"} & c.keys() for r in plan["records"] for c in r["packet"]["contexts"])
    for r in plan["records"]:
        if r["method"] == "bounded":
            assert "SECRET GOLD" not in r["prompt"] and r["packet"]["answer_quote"] == "SECRET GOLD"
    assert plan["options"]["num_predict"] == 512 and plan["options"]["num_thread"] == 3


def test_reference_retention_is_whitespace_only_and_requires_each_complete_quote_in_one_chunk():
    refs = [{"quote": "Alpha beta", "page": 1}, {"quote": "Gamma", "page": 1}]
    assert quality.reference_retention(refs, [{"text": "Alpha\nbeta"}]) == [True, False]
    assert quality.reference_retention(refs, [{"text": "Alpha"}, {"text": "beta"}]) == [False, False]
    assert quality.reference_retention(refs, [{"text": "alpha beta Gamma"}]) == [False, True]


def test_cross_document_context_is_rejected():
    data = study()
    with pytest.raises(ValueError, match="scoped"):
        quality.build_plan(data, lambda q: [{"text": "wrong", "docId": "other.pdf"}], lambda *a, **k: "prompt")


class Engine:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def identity(self):
        return study()["server_identity"]

    def answer(self, plan, record):
        self.calls.append(record["id"])
        if self.fail:
            raise TimeoutError("synthetic")
        return {"answer": "PRIVATE ANSWER", "first_text_seconds": 1., "done_reason": "stop",
                "metrics": {"prompt_eval_duration": 1_000_000_000, "eval_duration": 2_000_000_000,
                            "prompt_eval_count": 20, "eval_count": 30}}


def test_generation_exports_compatible_blind_packet_and_aggregate_only_runtime(tmp_path, monkeypatch):
    data, plan = prepared()
    monkeypatch.setattr(quality, "protected_hashes", lambda: {"frozen": "unchanged"})
    engine, report = Engine(), tmp_path / "runtime.json"
    output = quality.execute(data, tmp_path, report, retrieve=lambda _: plan, engine=engine)
    assert len(engine.calls) == len(set(engine.calls)) == 4
    packet, key = gen.read(tmp_path / "blind_packet.json"), gen.read(tmp_path / "private_key.json")
    assert len(packet["records"]) == 4 and packet["packet_id"] == gen.digest(packet["records"])
    assert all("method" not in r and "qid" not in r for r in packet["records"])
    assert {r["method"] for r in key["records"].values()} == {"full", "bounded"}
    serialized = json.dumps(output)
    for secret in ("PRIVATE ANSWER", "SECRET GOLD", "train0.pdf", "A001", "samples"):
        assert secret not in serialized
    assert output["timing"]["full"]["requests"] == 2 and not output["quality_assessed"]
    assert not (tmp_path / "generation.lock").exists()
    with pytest.raises(FileExistsError):
        quality.execute(data, tmp_path, report, engine=engine)
    assert len(engine.calls) == 4


def test_failed_answers_are_not_retrieved_or_generated_again(tmp_path, monkeypatch):
    data, plan = prepared()
    monkeypatch.setattr(quality, "protected_hashes", lambda: {"frozen": "unchanged"})
    engine, retrieval_calls = Engine(fail=True), []
    def retrieve(_):
        retrieval_calls.append(True)
        return plan
    with pytest.raises(TimeoutError):
        quality.execute(data, tmp_path, tmp_path / "runtime.json", retrieve, engine)
    with pytest.raises(ValueError, match="manual diagnosis"):
        quality.execute(data, tmp_path, tmp_path / "runtime.json", retrieve, engine)
    assert len(retrieval_calls) == len(engine.calls) == 1
    assert not (tmp_path / "blind_packet.json").exists()


def test_interrupted_retrieval_or_changed_protected_data_blocks_model_work(tmp_path, monkeypatch):
    data = study()
    monkeypatch.setattr(quality, "protected_hashes", lambda: {"frozen": "changed"})
    engine = Engine()
    with pytest.raises(ValueError, match="Protected"):
        quality.execute(data, tmp_path, tmp_path / "runtime.json", lambda _: pytest.fail("No model load"), engine)
    monkeypatch.setattr(quality, "protected_hashes", lambda: {"frozen": "unchanged"})
    gen.write_new(tmp_path / "retrieval_started.json", {"interrupted": True})
    with pytest.raises(FileExistsError):
        quality.execute(data, tmp_path, tmp_path / "runtime.json", lambda _: pytest.fail("No model load"), engine)
    assert not engine.calls


def judged():
    _, plan = prepared()
    answers = {r["id"]: {"answer": "PRIVATE ANSWER"} for r in plan["records"]}
    # Use the real exporter; packet format is shared, method identities remain private.
    from ml.eval.answer_grading import packet_from_answers
    packet, key = packet_from_answers(plan, answers)
    ratings = {"version": 1, "packet_id": packet["packet_id"], "ratings": [
        {"id": r["id"], "correctness": 2 if r["method"] == "full" else 1, "grounding": 2,
         "abstained": False, "correct_abstention": None, "notes": "PRIVATE NOTES"} for r in plan["records"]]}
    return packet, key, ratings


def test_quality_scoring_requires_all_ratings_and_reports_real_paired_regressions():
    packet, key, ratings = judged()
    report = quality.score(packet, key, ratings)
    assert report["metrics"]["correctness"]["bounded_minus_full"]["value"] == -1
    assert report["metrics"]["correctness"]["regressions"] == 2
    assert report["metrics"]["grounding"]["bounded_minus_full"]["value"] == 0
    assert report["quality_assessed"] and not report["live_defaults_changed"]
    assert "PRIVATE" not in json.dumps(report)
    with pytest.raises(ValueError, match="Complete all"):
        quality.score(packet, key, {**ratings, "ratings": ratings["ratings"][:-1]})
    changed = copy.deepcopy(key)
    first = next(iter(changed["records"]))
    changed["records"][first]["method"] = "unknown"
    with pytest.raises(ValueError, match="one TRAIN"):
        quality.score(packet, changed, ratings)


def test_frozen_question_ratings_path_is_rejected_before_any_read(monkeypatch):
    monkeypatch.setattr("sys.argv", ["context_quality", "--score", str(quality.ROOT / "ml/eval/questions.jsonl")])
    monkeypatch.setattr(quality, "load_study", lambda: pytest.fail("No reads expected"))
    with pytest.raises(SystemExit):
        quality.main()


def test_train_gate_precedes_pdf_or_bundle_access(tmp_path, monkeypatch):
    (tmp_path / "Test PDFs").mkdir()
    (tmp_path / "ml/models/artifacts/ml5").mkdir(parents=True)
    (tmp_path / "Test PDFs/manifest.csv").write_text("file,group\nfrozen.pdf,test\n")
    gen.write_new(tmp_path / "ml/splits.json", {"status": "frozen", "train_groups": ["train"], "test_groups": ["test"], "excluded_groups": []})
    gen.write_new(tmp_path / "ml/models/artifacts/ml5/protocol.json", {"train_files": ["frozen.pdf"]})
    monkeypatch.setattr(quality, "ROOT", tmp_path)
    monkeypatch.setattr(quality, "SPECS", (("frozen.pdf", ("concept",), "Question"),))
    with pytest.raises(ValueError, match="TRAIN groups"):
        quality.training_questions()


def test_reference_must_match_native_pdf_and_exact_source(tmp_path, monkeypatch):
    import pymupdf
    import yaml
    (tmp_path / "Test PDFs").mkdir()
    (tmp_path / "ml/models/artifacts/ml5").mkdir(parents=True)
    bundle = tmp_path / "ml/out/bundles/train/definitions"
    bundle.mkdir(parents=True)
    (tmp_path / "Test PDFs/manifest.csv").write_text("file,group\ntrain.pdf,train\n")
    gen.write_new(tmp_path / "ml/splits.json", {"status": "frozen", "train_groups": ["train"], "test_groups": [], "excluded_groups": []})
    gen.write_new(tmp_path / "ml/models/artifacts/ml5/protocol.json", {"train_files": ["train.pdf"]})
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((50, 50), "A finite collection.")
        pdf.save(tmp_path / "Test PDFs/train.pdf")
    meta = {"margin": {"page": 1}, "description": "A finite collection.", "sources": [{"title": "train.pdf"}]}
    path = bundle / "concept.md"
    path.write_text("---\n" + yaml.safe_dump(meta) + "---\nbody")
    monkeypatch.setattr(quality, "ROOT", tmp_path)
    monkeypatch.setattr(quality, "SPECS", (("train.pdf", ("concept",), "Fresh question"),))
    rows, sources = quality.training_questions()
    assert rows[0]["references"][0]["quote"] == "A finite collection."
    assert "Test PDFs/train.pdf" in sources
    meta["description"] = "Unsupported reference."
    path.write_text("---\n" + yaml.safe_dump(meta) + "---\nbody")
    with pytest.raises(ValueError, match="native TRAIN"):
        quality.training_questions()
