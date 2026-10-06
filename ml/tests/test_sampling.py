"""Independent test-only input, enriched strata and deterministic filtering."""

import pytest

from ml.data.sample_for_labelling import sample_blocks


def data():
    blocks = []
    for index in range(450):
        blocks.append({"block_id": f"{index:04}", "group": f"test-{index % 3}",
                       "file": f"{index % 3}.pdf", "page": index + 1,
                       "text": "We say that this is a sufficiently long prose definition." if index < 150 else
                       "A sufficiently long ordinary block for independent evaluation.",
                       "weak_label": "theorem" if index >= 300 else None, "flags": []})
    return blocks, {"status": "frozen", "test_groups": [f"test-{i}" for i in range(3)]}


def test_exact_size_strata_and_hidden_labels():
    rows, report = sample_blocks(*data())
    assert len(rows) == len({row["block_id"] for row in rows}) == 300
    assert report["strata"] == {"weak": 100, "prose": 100, "unlabelled": 100}
    assert all(set(row) == {"block_id", "file", "page", "text"} for row in rows)
    assert max(report["groups"].values()) - min(report["groups"].values()) <= 3


def test_reproducible_input_order_and_seed():
    blocks, split = data()
    assert sample_blocks(blocks, split) == sample_blocks(blocks[::-1], split)
    assert sample_blocks(blocks, split)[0] != sample_blocks(blocks, split, seed=7)[0]


def test_no_train_short_furniture_or_toc_blocks():
    blocks, split = data()
    excluded = [dict(blocks[0], block_id="train", group="train"),
                dict(blocks[0], block_id="short", text="short"),
                dict(blocks[0], block_id="furniture", flags=["furniture"]),
                dict(blocks[0], block_id="toc", text="Introduction ............... 42")]
    rows, _ = sample_blocks(blocks + excluded, split)
    assert not {b["block_id"] for b in excluded} & {r["block_id"] for r in rows}


def test_contents_page_context_is_removed():
    blocks, split = data()
    contents = [dict(blocks[0], block_id=f"toc-{i}", page=999,
                     text=f"Chapter {i} ................... 42") for i in range(5)]
    contents.append(dict(blocks[0], block_id="toc-title", page=999, text="Table of contents for this mathematical book"))
    rows, _ = sample_blocks(blocks + contents, split)
    assert not any(row["page"] == 999 for row in rows)


def test_small_stratum_backfills_without_duplicates():
    blocks, split = data()
    for block in blocks[:140]:
        block["text"] = "An ordinary long block which does not introduce any concepts."
    rows, report = sample_blocks(blocks, split)
    assert len(rows) == len({row["block_id"] for row in rows}) == 300
    assert report["strata"]["prose"] == 10


@pytest.mark.parametrize("fault", ["unfrozen", "duplicate", "insufficient"])
def test_invalid_dataset_is_rejected(fault):
    blocks, split = data()
    if fault == "unfrozen":
        split["status"] = "proposed"
    elif fault == "duplicate":
        blocks.append(blocks[0])
    else:
        blocks = blocks[:5]
    with pytest.raises(ValueError):
        sample_blocks(blocks, split)
