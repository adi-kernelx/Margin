"""Synthetic tests: no encoders, LLM, frozen questions or user interface."""

import copy
import json

import pytest

from ml.eval import answer_generation as gen, context_revision as revision, grounded_prompt
from ml.retrieval.context_packing import SEPARATOR, select_contexts, units


def test_selection_finds_complementary_definitions_below_irrelevant_first_context():
    raw = [{"text": "A theorem about pumping and repeated states. " * 100, "page": 99},
           {"text": "Alphabet An alphabet is a finite nonempty set of symbols. " * 3, "title": "Alphabet", "page": 4},
           {"text": "A language is a set of strings.", "title": "Language", "page": 8}]
    before = copy.deepcopy(raw)
    selected = select_contexts("How does an alphabet differ from a language?", raw)
    assert "finite nonempty" in " ".join(c["text"] for c in selected)
    assert "set of strings" in " ".join(c["text"] for c in selected)
    assert sum(c["text"].count("An alphabet is") for c in selected) == 1
    assert selected == select_contexts("How does an alphabet differ from a language?", raw)
    assert raw == before


def test_budget_counts_utf8_and_omission_markers_and_limits_sources():
    raw = [{"text": f"Boundary {i} ε Σ café. Repeated condition {i} applies.", "page": i} for i in range(8)]
    selected = select_contexts("boundary repeated condition", raw, byte_budget=130, max_sources=2)
    assert 0 < sum(len(c["text"].encode("utf-8")) for c in selected) <= 130
    assert len(selected) <= 2
    for c in selected:
        assert all(u in raw[c["page"]]["text"] for u in c["text"].split(SEPARATOR))
        assert "�" not in c["text"]
    assert list(units("Σ", 1)) == []
    assert select_contexts("question", []) == []
    with pytest.raises(ValueError):
        select_contexts("question", raw, byte_budget=0)


def test_no_reference_inputs_and_no_rewriting_mathematical_notation():
    raw = [{"text": "A zero-length string is denoted ε; Σ is an alphabet.", "page": 1}]
    selected = select_contexts("Which notation denotes a string?", raw)
    assert selected[0]["text"] == raw[0]["text"]
    raw[0]["answer_quote"] = "ORACLE SECRET"
    assert select_contexts("Which notation denotes a string?", raw)[0]["text"] == selected[0]["text"]
    assert "ORACLE SECRET" not in grounded_prompt.build_prompt("Question?", selected)


def test_packer_keeps_legal_text_when_that_is_the_question():
    raw = [{"text": "Copyright: redistribution is prohibited.", "page": 2},
           {"text": "A matrix has rows and columns.", "page": 3}]
    assert "redistribution" in select_contexts("What redistribution is prohibited?", raw)[0]["text"]


def test_grounded_prompt_renumbers_actual_excerpts_and_syntax_check_is_not_semantic():
    prompt = grounded_prompt.build_prompt("Compare the definitions", [{"text": "First", "page": 152}, {"text": "Second", "page": 40}])
    assert "[1] (page 152) First" in prompt and "[2] (page 40) Second" in prompt
    assert "verbatim comparison" in prompt and "straightforward reasoning" in prompt
    assert "(No source excerpts available.)" in grounded_prompt.build_prompt("Fact?", [])
    audit = grounded_prompt.citation_audit("Supported [1, 2], wrong [3] [0].", 2)
    assert audit == {"citation_mentions": 4, "invalid_mentions": 2, "no_citation": False, "semantic_support_assessed": False}
    assert grounded_prompt.citation_audit("I cannot find it.", 0)["no_citation"]


def study():
    return {"model": gen.MODEL, "identity": {"digest": "a"*64}, "options": revision.OPTIONS,
            "server_identity": {"model": gen.MODEL, "digest": "a"*64, "ollama_version": "test"},
            "system": "fixed system", "protected": {"old": "same"}, "questions": [
                {"qid": f"Q{i}", "file": f"train{i}.pdf", "question": "What is a boundary?", "split": "train",
                 "answerable": i != 2, "references": [] if i == 2 else [{"page": 1, "quote": "SECRET REFERENCE"}],
                 "cohort": cohort} for i, cohort in enumerate(("previous_development", "new_answerable", "synthetic_unsupported"))]}


def contexts(q):
    return [{"text": "A boundary separates two classes.", "page": 1, "pdfFingerprint": q["file"], "relevance_score": 9}]


class Engine:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def identity(self):
        return study()["server_identity"]

    def answer(self, plan, record):
        self.calls.append(record["id"])
        if self.fail:
            raise TimeoutError("synthetic")
        return {"answer": "PRIVATE ANSWER [1]", "first_text_seconds": 1, "done_reason": "stop",
                "metrics": {"prompt_eval_duration": 1_000_000_000, "eval_duration": 2_000_000_000,
                            "prompt_eval_count": 20, "eval_count": 30}}


def test_paired_plan_is_deterministic_scoped_and_does_not_inject_gold():
    data = study()
    plan = revision.build_plan(data, contexts)
    assert plan == revision.build_plan(data, contexts)
    assert len(plan["records"]) == len({r["id"] for r in plan["records"]}) == 6
    for r in plan["records"]:
        assert "SECRET REFERENCE" not in r["prompt"]
        assert not {"pdfFingerprint", "relevance_score"} & r["packet"]["contexts"][0].keys()
        assert r["packet"]["answerable"] == (r["qid"] != "Q2")
        if r["method"] == "bounded":
            assert "SOURCE EXCERPTS" in r["prompt"]
        else:
            assert "CONTEXT FROM DOCUMENT" in r["prompt"]
    with pytest.raises(ValueError, match="scoped"):
        revision.build_plan(data, lambda q: [{"text": "wrong", "docId": "frozen.pdf"}])


def test_negative_probes_do_not_inflate_reference_retention_and_runtime_is_aggregate_only(tmp_path, monkeypatch):
    monkeypatch.setattr(revision, "protected_hashes", lambda: {"old": "same"})
    engine, plan = Engine(), revision.build_plan(study(), contexts)
    output = revision.execute(study(), tmp_path, tmp_path / "runtime.json", lambda _: plan, engine)
    assert output["answers"] == 6 and output["answerable_questions"] == 2 and output["unsupported_probes"] == 1
    assert output["complete_reference_questions"] == {"raw": 0, "full": 0, "bounded": 0}
    assert len(engine.calls) == len(set(engine.calls)) == 6
    assert gen.read(tmp_path / "blind_packet.json")["packet_id"] == gen.digest(gen.read(tmp_path / "blind_packet.json")["records"])
    for secret in ("PRIVATE ANSWER", "SECRET REFERENCE", "A001", "train0.pdf"):
        assert secret not in json.dumps(output)
    with pytest.raises(FileExistsError):
        revision.execute(study(), tmp_path, tmp_path / "runtime.json", engine=engine)


def test_protection_failures_and_interrupted_retrieval_stop_model_calls(tmp_path, monkeypatch):
    data, engine = study(), Engine()
    monkeypatch.setattr(revision, "protected_hashes", lambda: {"old": "changed"})
    with pytest.raises(ValueError, match="Protected"):
        revision.execute(data, tmp_path, tmp_path / "runtime.json", lambda _: pytest.fail("no retrieval"), engine)
    monkeypatch.setattr(revision, "protected_hashes", lambda: {"old": "same"})
    gen.write_new(tmp_path / "retrieval_started.json", {"interrupted": True})
    with pytest.raises(FileExistsError):
        revision.execute(data, tmp_path, tmp_path / "runtime.json", lambda _: pytest.fail("no retrieval"), engine)
    assert not engine.calls


def test_failed_generation_is_preserved_without_retry_or_retrieval_repeat(tmp_path, monkeypatch):
    monkeypatch.setattr(revision, "protected_hashes", lambda: {"old": "same"})
    engine = Engine(fail=True)
    plan = revision.build_plan(study(), contexts)
    with pytest.raises(TimeoutError):
        revision.execute(study(), tmp_path, tmp_path / "runtime.json", lambda _: plan, engine)
    with pytest.raises(ValueError, match="manual diagnosis"):
        revision.execute(study(), tmp_path, tmp_path / "runtime.json", lambda _: pytest.fail("no retrieval"), engine)
    assert len(engine.calls) == 1


@pytest.mark.parametrize("negative_error", [False, True])
def test_ratings_are_sealed_before_key_access_and_failed_probe_blocks_decision(tmp_path, monkeypatch, negative_error):
    monkeypatch.setattr(revision, "protected_hashes", lambda: {"old": "same"})
    monkeypatch.setattr(revision, "load_study", lambda _: study())
    runtime = tmp_path / "runtime.json"
    monkeypatch.setattr(revision, "RUNTIME_REPORT", runtime)
    plan = revision.build_plan(study(), contexts)
    revision.execute(study(), tmp_path, runtime, lambda _: plan, Engine())
    packet = gen.read(tmp_path / "blind_packet.json")
    ratings = {"version": 1, "packet_id": packet["packet_id"], "ratings": [
        {"id": r["id"], "correctness": 2, "grounding": 2, "abstained": not r["answerable"],
         "correct_abstention": None if r["answerable"] else True, "notes": "PRIVATE NOTES"} for r in packet["records"]]}
    if negative_error:
        target = next(r["id"] for r in plan["records"] if r["qid"] == "Q2" and r["method"] == "bounded")
        rating = next(r for r in ratings["ratings"] if r["id"] == target)
        rating.update(correctness=0, grounding=0, abstained=False, correct_abstention=False)
    path = tmp_path / "ratings.json"
    gen.write_new(path, ratings)
    original_read = gen.read
    def read(path):
        if path.name == "private_key.json":
            assert (tmp_path / "grading_receipt.json").exists()
        return original_read(path)
    monkeypatch.setattr(gen, "read", read)
    output = revision.score_review(path, tmp_path, tmp_path / "quality.json")
    assert output["decision"] == ("hold_revision" if negative_error else "screen_passed_further_validation_required")
    assert output["correct_abstention"]["bounded"]["value"] == (0 if negative_error else 1)
    assert not output["grading"]["human_validation"] and not output["live_defaults_changed"]
    assert "PRIVATE NOTES" not in json.dumps(output)
    assert set(output["cohorts"]) == {"previous_development", "new_answerable", "synthetic_unsupported"}


def test_incomplete_review_does_not_open_private_key(tmp_path, monkeypatch):
    monkeypatch.setattr(revision, "protected_hashes", lambda: {"old": "same"})
    monkeypatch.setattr(revision, "load_study", lambda _: study())
    revision.execute(study(), tmp_path, tmp_path / "runtime.json", lambda _: revision.build_plan(study(), contexts), Engine())
    packet = gen.read(tmp_path / "blind_packet.json")
    path = tmp_path / "ratings.json"
    gen.write_new(path, {"version": 1, "packet_id": packet["packet_id"], "ratings": []})
    with pytest.raises(ValueError, match="Complete all"):
        revision.score_review(path, tmp_path, tmp_path / "quality.json")
    assert not (tmp_path / "grading_receipt.json").exists()


def test_train_gate_precedes_native_source_access(tmp_path, monkeypatch):
    (tmp_path / "Test PDFs").mkdir()
    (tmp_path / "ml/models/artifacts/ml5").mkdir(parents=True)
    (tmp_path / "Test PDFs/manifest.csv").write_text("file,group\nfrozen.pdf,test\n")
    gen.write_new(tmp_path / "ml/splits.json", {"status": "frozen", "train_groups": ["train"], "test_groups": ["test"], "excluded_groups": []})
    gen.write_new(tmp_path / "ml/models/artifacts/ml5/protocol.json", {"train_files": ["frozen.pdf"]})
    monkeypatch.setattr(revision, "ROOT", tmp_path)
    monkeypatch.setattr(revision, "NEW_SPECS", (("frozen.pdf", "concept", "Question"),))
    with pytest.raises(ValueError, match="TRAIN groups"):
        revision.fresh_questions()


def test_frozen_questions_cannot_be_ratings(monkeypatch):
    monkeypatch.setattr("sys.argv", ["context_revision", "--score", str(revision.ROOT / "ml/eval/questions.jsonl")])
    monkeypatch.setattr(revision, "load_study", lambda: pytest.fail("No reads"))
    with pytest.raises(SystemExit):
        revision.main()


def test_native_claim_checks_ignore_truncated_metadata_but_reject_unsupported_probes(tmp_path, monkeypatch):
    import pymupdf
    import yaml
    (tmp_path / "Test PDFs").mkdir()
    (tmp_path / "ml/models/artifacts/ml5").mkdir(parents=True)
    bundle = tmp_path / "ml/out/bundles/train/definitions"
    bundle.mkdir(parents=True)
    (tmp_path / "Test PDFs/manifest.csv").write_text("file,group\ntrain.pdf,train\n")
    gen.write_new(tmp_path / "ml/splits.json", {"status": "frozen", "train_groups": ["train"], "test_groups": [], "excluded_groups": []})
    gen.write_new(tmp_path / "ml/models/artifacts/ml5/protocol.json", {"train_files": ["train.pdf"]})
    path = tmp_path / "Test PDFs/train.pdf"
    def save(text):
        with pymupdf.open() as pdf:
            pdf.new_page().insert_text((50, 50), text)
            pdf.save(path)
    save("A boundary separates classes.")
    meta = {"description": "Truncated...", "margin": {"page": 1}, "sources": [{"title": "train.pdf"}]}
    markdown = "---\n" + yaml.safe_dump(meta) + "---\n\n> A boundary separates classes.\n"
    (bundle / "concept.md").write_text(markdown, encoding="utf-8")
    monkeypatch.setattr(revision, "ROOT", tmp_path)
    monkeypatch.setattr(revision, "NEW_SPECS", (("train.pdf", "concept", "What is a boundary?"),
                                              ("train.pdf", "concept", "Which classes?"),
                                              ("train.pdf", None, "When was " + revision.NONCES[0] + " launched?")))
    rows, sources = revision.fresh_questions()
    assert rows[0]["references"][0]["quote"] == "A boundary separates classes."
    assert not rows[2]["answerable"] and not rows[2]["references"]
    assert "Test PDFs/train.pdf" in sources
    save("A boundary separates classes. " + revision.NONCES[0])
    with pytest.raises(ValueError, match="absent"):
        revision.fresh_questions()
