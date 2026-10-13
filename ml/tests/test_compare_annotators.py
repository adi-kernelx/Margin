"""Second-annotator loading and agreement on toy data."""

import json

import pytest

from ml.eval.compare_annotators import agreement, load_b


def write(folder, name, rows, junk=False):
    lines = (["```json"] if junk else []) + [json.dumps(r) for r in rows] + (["```"] if junk else [])
    (folder / name).write_text("\n".join(lines), encoding="utf-8")


def test_load_tolerates_code_fences_and_enforces_definition_implication(tmp_path):
    write(tmp_path, "batch_01.jsonl", [{"block_id": "a", "label": "notation", "contains_definition": False},
                                       {"block_id": "b", "label": "proof", "contains_definition": True}], junk=True)
    b = load_b({"a", "b"}, tmp_path)
    assert b["a"]["contains_definition"] is True and b["b"]["label"] == "proof"


@pytest.mark.parametrize("row", [{"block_id": "zz", "label": "proof", "contains_definition": False},
                                 {"block_id": "a", "label": "lemma", "contains_definition": False},
                                 {"block_id": "a", "label": "proof", "contains_definition": "yes"}])
def test_load_rejects_unknown_ids_labels_and_types(tmp_path, row):
    write(tmp_path, "batch_01.jsonl", [row])
    with pytest.raises(ValueError):
        load_b({"a"}, tmp_path)


def test_agreement_counts_and_pairs():
    a = {"x": {"label": "proof", "contains_definition": False}, "y": {"label": "definition", "contains_definition": True}}
    b = {"x": {"label": "proof", "contains_definition": True}, "y": {"label": "notation", "contains_definition": True}}
    report = agreement(a, b, ["x", "y"])
    assert report["raw_roles"] == 0.5 and report["raw_contains_definition"] == 0.5
    assert report["kappa_merged"] == 1.0 and report["role_pairs"] == [("definition->notation", 1)]
