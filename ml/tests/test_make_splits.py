"""Source isolation, reproducibility and invalid extraction checks."""

import pytest

from ml.data.make_splits import KEEP_TRAIN, REQUIRED_TEST, make_split


def fixture_data():
    groups = sorted(REQUIRED_TEST | KEEP_TRAIN | {"extra-a", "extra-b", "extra-c", "extra-d"})
    rows, blocks = [], []
    for group in groups:
        category = "textbook" if group in {"sipser", "levin-discrete"} else "paper"
        rows.append({"file": group + ".pdf", "group": group, "category": category, "use": "main"})
        for index in range(10):
            blocks.append({"file": group + ".pdf", "group": group, "category": category,
                           "block_id": f"{group}-{index}", "weak_label": "definition"})
    rows.append({"file": "scan.pdf", "group": "scan", "category": "textbook", "use": "scan-slice"})
    return rows, blocks


def test_isolation_and_exhaustive_group_partition():
    rows, blocks = fixture_data()
    # A second file from the same source must follow the first into test.
    rows.append(dict(rows[0], file="second.pdf"))
    blocks.append(dict(blocks[0], file="second.pdf", block_id="second"))
    split = make_split(rows, blocks)
    train, test, excluded = (set(split[key]) for key in ("train_groups", "test_groups", "excluded_groups"))
    assert not (train & test or train & excluded or test & excluded)
    assert train | test | excluded == {row["group"] for row in rows}
    assert KEEP_TRAIN <= train and REQUIRED_TEST <= test
    assert len(test) == 10
    assert sum(part["blocks"] for part in split["stats"].values()) == len(blocks)
    assert split["group_stats"][rows[0]["group"]]["files"] == 2


def test_deterministic_even_if_inputs_reordered():
    rows, blocks = fixture_data()
    assert make_split(rows, blocks) == make_split(rows[::-1], blocks[::-1])


def test_proposal_includes_textbook_and_zero_labels():
    split = make_split(*fixture_data())
    assert split["status"] == "proposed" and split["warnings"] == []
    assert "textbook" in split["stats"]["test"]["categories"]
    assert split["stats"]["test"]["labels"]["notation"] == 0


def test_textbook_coverage_is_required():
    rows, blocks = fixture_data()
    for record in rows + blocks:
        record["category"] = "paper"
    with pytest.raises(ValueError, match="textbook"):
        make_split(rows, blocks)


def test_multiple_extraction_files_are_loaded(tmp_path):
    import json
    from ml.data.make_splits import load_inputs

    manifest = tmp_path / "manifest.csv"
    manifest.write_text("file,group,category,use\na.pdf,a,paper,main\n", encoding="utf-8")
    paths = [tmp_path / "a.jsonl", tmp_path / "b.jsonl"]
    for index, path in enumerate(paths):
        path.write_text(json.dumps({"block_id": str(index)}) + "\n", encoding="utf-8")
    rows, blocks = load_inputs(manifest, paths)
    assert rows[0]["group"] == "a"
    assert [block["block_id"] for block in blocks] == ["0", "1"]


@pytest.mark.parametrize("fault", ["missing-file", "wrong-group", "duplicate-id", "excluded-block",
                                 "mixed-group", "unknown-label", "too-few-labels", "no-definitions",
                                 "duplicate-file", "unknown-use"])
def test_invalid_inputs_rejected(fault):
    rows, blocks = fixture_data()
    if fault == "missing-file":
        blocks = blocks[10:]
    elif fault == "wrong-group":
        blocks[0]["group"] = "wrong"
    elif fault == "duplicate-id":
        blocks[1]["block_id"] = blocks[0]["block_id"]
    elif fault == "excluded-block":
        blocks.append(dict(blocks[0], file="scan.pdf", group="scan", block_id="scan"))
    elif fault == "mixed-group":
        rows[-1]["group"] = rows[0]["group"]
    elif fault == "unknown-label":
        blocks[0]["weak_label"] = "unknown"
    elif fault == "too-few-labels":
        for block in blocks:
            block["weak_label"] = None
    elif fault == "no-definitions":
        for block in blocks:
            block["weak_label"] = "theorem"
    elif fault == "duplicate-file":
        rows.append(rows[0])
    elif fault == "unknown-use":
        rows[0]["use"] = "unknown"
    with pytest.raises(ValueError):
        make_split(rows, blocks)


def test_frozen_split_matches_current_dataset():
    """Validate acceptance metadata and detect source/count drift after freeze."""
    import json
    from pathlib import Path
    from ml.data.make_splits import load_inputs

    root = Path(__file__).resolve().parents[2]
    proposal = json.loads((root / "ml/splits.json").read_text(encoding="utf-8"))
    assert proposal.pop("status") == "frozen"
    assert proposal.pop("accepted_on") == "2026-10-06"
    assert proposal.pop("acceptance") == "User: Accept and freeze the revised split."
    blocks_paths = [root / "ml/out/full/blocks_sample.jsonl", root / "ml/out/levin/blocks_sample.jsonl"]
    if not all(path.exists() for path in blocks_paths):
        pytest.skip("Private extraction is unavailable on this checkout")
    recomputed = make_split(*load_inputs(root / "Test PDFs/manifest.csv", blocks_paths))
    recomputed.pop("status")
    assert recomputed == proposal
