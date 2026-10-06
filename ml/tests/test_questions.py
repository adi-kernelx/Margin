"""Gold-evidence validation, split routing and real native-text PDF integration."""

import json

import pymupdf
import pytest

from ml.eval.validate_questions import group_splits, main, summarise, validate_lines, validate_record


MANIFEST = {"a.pdf": {"group": "source", "use": "main"}}
SPLITS = {"source": "test"}


def question():
    return {"qid": "q001", "file": "a.pdf", "group": "source", "question": "What is regular?",
            "answer_pages": [2], "answer_quote": "A regular point has independent gradients.",
            "type": "definition", "answerable": True}


def texts(filename):
    return ["Cover", "A regular\npoint has independent   gradients."]


def test_native_whitespace_quote_and_derived_test_split():
    result = validate_record(question(), MANIFEST, SPLITS, texts)
    assert result["split"] == "test"
    assert "split" not in question()


@pytest.mark.parametrize("change", [
    {"answer_quote": "regular point..."}, {"answer_quote": "a regular point has independent gradients."},
    {"answer_pages": [1]}, {"answer_pages": [3]}, {"answer_pages": [True]},
    {"answer_pages": [2, 2]}, {"answer_pages": []}, {"answer_quote": " "},
    {"answerable": "true"}, {"type": "unknown"}, {"group": "wrong"},
    {"file": "unknown.pdf"}, {"split": "train"}, {"question": " "},
    {"unexpected": "typo"}, {"answer_pages": "2"},
])
def test_invalid_schema_or_evidence_is_rejected(change):
    with pytest.raises(ValueError):
        validate_record(dict(question(), **change), MANIFEST, SPLITS, texts)


def test_unanswerable_needs_no_pages_or_quote():
    row = dict(question(), answerable=False, answer_pages=[], answer_quote="")
    assert validate_record(row, MANIFEST, SPLITS, texts)["answerable"] is False
    for change in ({"answer_pages": [2]}, {"answer_quote": "something"}):
        with pytest.raises(ValueError):
            validate_record(dict(row, **change), MANIFEST, SPLITS, texts)


def test_excluded_source_rejected():
    with pytest.raises(ValueError, match="excluded"):
        validate_record(question(), MANIFEST, {"source": "excluded"}, texts)


def test_jsonl_errors_accumulate_and_duplicates_report_physical_lines():
    row = json.dumps(question())
    valid, errors = validate_lines([row, "\n", "{", row], MANIFEST, SPLITS, texts)
    assert len(valid) == 1 and len(errors) == 2
    assert errors[0].startswith("line 3:") and errors[1] == "line 4: Duplicate qid"
    assert summarise(valid)["split"] == {"test": 1}
    assert validate_lines([], MANIFEST, SPLITS, texts)[1] == ["Question file is empty"]


def test_frozen_source_partition_required():
    split = {"status": "frozen", "train_groups": ["train"], "test_groups": ["test"], "excluded_groups": []}
    assert group_splits(split) == {"train": "train", "test": "test"}
    with pytest.raises(ValueError):
        group_splits(dict(split, status="proposed"))
    with pytest.raises(ValueError):
        group_splits(dict(split, train_groups=["test"]))


def test_cli_real_pdf_bounds_quotes_readonly_and_collection_gate(tmp_path, capsys):
    pdf = tmp_path / "a.pdf"
    with pymupdf.open() as document:
        document.new_page().insert_text((72,72), "Cover")
        document.new_page().insert_text((72,72), question()["answer_quote"])
        document.save(pdf)
    manifest = tmp_path / "manifest.csv"
    manifest.write_text("file,group,use\na.pdf,source,main\n", encoding="utf-8")
    split = tmp_path / "split.json"
    split.write_text(json.dumps({"status":"frozen", "train_groups":[], "test_groups":["source"], "excluded_groups":[]}), encoding="utf-8")
    questions = tmp_path / "questions.jsonl"
    questions.write_text(json.dumps(question()) + "\n", encoding="utf-8")
    before = questions.read_bytes()
    argv = ["--questions", str(questions), "--manifest", str(manifest), "--split", str(split), "--pdf-dir", str(tmp_path)]
    assert main(argv) == 0
    output = capsys.readouterr()
    assert '"test": 1' in output.out and "VALID" in output.out
    assert question()["answer_quote"] not in output.out
    assert questions.read_bytes() == before
    assert main(argv + ["--require-complete"]) == 1
    assert "Collection incomplete" in capsys.readouterr().err
    questions.write_text(json.dumps(dict(question(), answer_pages=[999])), encoding="utf-8")
    assert main(argv) == 1
    assert "actual PDF page count" in capsys.readouterr().err


def test_missing_question_file_has_actionable_error(tmp_path, capsys):
    assert main(["--manifest", str(tmp_path / "missing.csv")]) == 1
    assert "Cannot validate" in capsys.readouterr().err


def test_missing_pdf_becomes_line_error_instead_of_crashing():
    def missing(filename):
        raise pymupdf.FileNotFoundError("Missing PDF: " + filename)
    rows, errors = validate_lines([json.dumps(question())], MANIFEST, SPLITS, missing)
    assert not rows and errors == ["line 1: Missing PDF: a.pdf"]
