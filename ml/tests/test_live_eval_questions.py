"""Frozen evidence is not validated during training-only evaluation."""

import json
from types import SimpleNamespace

import pytest

from ml.eval import live_rag_eval


@pytest.mark.parametrize("milestone", [False, True])
def test_load_questions_routes_before_evidence_validation(tmp_path, monkeypatch, milestone):
    (tmp_path / "Test PDFs").mkdir()
    (tmp_path / "ml").mkdir()
    (tmp_path / "Test PDFs/manifest.csv").write_text(
        "file,group,use\ntrain.pdf,train-group,main\ntest.pdf,test-group,main\n", encoding="utf-8")
    (tmp_path / "ml/splits.json").write_text(json.dumps({
        "status": "frozen", "train_groups": ["train-group"],
        "test_groups": ["test-group"], "excluded_groups": []}), encoding="utf-8")
    questions = tmp_path / "questions.jsonl"
    questions.write_text('\n'.join(json.dumps({"file": file, "split": "train"})
                                   for file in ("train.pdf", "test.pdf")), encoding="utf-8")
    monkeypatch.setattr(live_rag_eval, "ROOT", tmp_path)
    seen = []

    def validate(lines, manifest, splits, page_texts):
        seen.extend(json.loads(line)["file"] for line in lines)
        return [{"answerable": True, "split": splits[manifest[file]["group"]]}
                for file in seen], []

    monkeypatch.setattr(live_rag_eval, "validate_lines", validate)
    rows, splits = live_rag_eval.load_questions(SimpleNamespace(
        questions=questions, pdf_dir=tmp_path, frozen_test_milestone=milestone))
    assert seen == (["train.pdf", "test.pdf"] if milestone else ["train.pdf"])
    assert len(rows) == (2 if milestone else 1)
    assert splits == ({"train", "test"} if milestone else {"train"})


def test_ranker_development_command_rejects_frozen_read(monkeypatch):
    from ml.eval import ranker_eval

    monkeypatch.setattr("sys.argv", ["ranker_eval", "--out", "unused.json", "--frozen-test-milestone"])

    def forbidden(*args):
        pytest.fail("Development evaluator must reject the flag before loading questions")

    monkeypatch.setattr(ranker_eval, "load_questions", forbidden)
    with pytest.raises(SystemExit, match="inference-only"):
        ranker_eval.main()


def test_cache_required_rejects_missing_cache_before_questions(tmp_path, monkeypatch):
    from ml.eval import ranker_eval

    monkeypatch.setattr("sys.argv", ["ranker_eval", "--out", "unused.json", "--require-cache",
                                     "--groups", str(tmp_path / "missing.json")])
    monkeypatch.setattr(ranker_eval, "load_questions", lambda *args: pytest.fail("Must not read questions"))
    with pytest.raises(SystemExit, match="existing candidate cache"):
        ranker_eval.main()


@pytest.mark.parametrize("change", ["qid", "file", "answer_pages", "features", "labels"])
def test_cache_mismatch_is_rejected(change):
    from ml.eval.ranker_eval import validate_cached_groups
    from ml.ranking.features import FEATURES

    questions = [{"qid": "q", "file": "train.pdf", "answer_pages": [1]}]
    group = {"qid": "q", "file": "train.pdf", "answer_pages": [1], "pages": [1],
             "features": [[0.0] * len(FEATURES)], "labels": [1]}
    validate_cached_groups([group], questions)
    group[change] = {"qid": "test-q", "file": "test.pdf", "answer_pages": [2],
                     "features": [[0.0]], "labels": []}[change]
    with pytest.raises(ValueError, match="cache"):
        validate_cached_groups([group], questions)
