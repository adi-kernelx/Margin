"""Regression cases for table headers, proof starts, equations and frozen folds."""
import pytest

from ml.data.extract_blocks import RawBlock, build_visual_lines, extend_math_blocks, group_lines_into_blocks
from ml.data.heading_rules import detect_heading, remove_heading_from_text
from ml.data.prepare_training import prepare
from ml.data.repair_training import original_folds
from ml.eval.training_quality import quality_summary
from ml.tests.test_layout import span, BODY, PAGE_W
from ml.tests.test_training_data import inputs


def lines(texts):
    return build_visual_lines([span(text, 70, 100 + 18*i, 500, bold=text.startswith("Proof"))
                               for i, text in enumerate(texts)], 0, 1, PAGE_W)[1]


def test_formatted_proof_without_period_is_split_from_theorem():
    values = lines(["Lemma 2.", "The set is bounded.", "PROOF Let x be in the set.", "Then the bound follows."])
    blocks = group_lines_into_blocks(values, PAGE_W, 800, 1, False, BODY)
    assert len(blocks) == 2
    assert blocks[1].lines[0].text.startswith("PROOF")
    heading = detect_heading("PROOF Let x be in the set.", is_uppercase=True)
    assert heading.weak_label == "proof" and heading.heading_text == "PROOF"
    assert remove_heading_from_text("PROOF Let x be in the set.", heading.heading_text).startswith("Let")


@pytest.mark.parametrize("text", ["Proof is missing.", "Proof of concept is useful.", "proof Let x be positive."])
def test_proof_references_still_rejected(text):
    assert detect_heading(text, is_bold=True) is None


def test_algorithm_timing_header_not_a_function_heading():
    assert detect_heading("Algorithm xi (ms) (ms) Tail Type", has_font_change=True) is None
    assert detect_heading("Algorithm Encrypt (m, key)", is_bold=True).weak_label == "algorithm"


def test_ascii_equation_identified_and_kept_with_heading():
    values = lines(["Example 1.", "Let the function be given by", "f(x) = ||x||."])
    assert values[-1].is_display_math
    blocks = group_lines_into_blocks(values, PAGE_W, 800, 1, False, BODY)
    assert len(blocks) == 1 and len(blocks[0].lines) == 3


def test_sparse_equation_gaps_not_mistaken_for_two_prose_columns():
    spans = [span("Example 1.", 30, 80, 120)]
    for index in range(10):
        spans.extend([span("=", 270, 110 + 18*index, 280),
                      span("x + y = z", 330, 110 + 18*index, 430)])
    columns, values = build_visual_lines(spans, 0, 1, PAGE_W)
    assert columns == 1 and all(line.column == 0 for line in values)


def test_long_equation_with_few_greek_symbols_is_display_math():
    values = lines(["Proof. The expansion yields", "f(x) - f(a) - F(a)(x-a) = O(||x-a|| squared)."])
    assert values[1].is_display_math
    assert len(group_lines_into_blocks(values, PAGE_W, 800, 1, False, BODY)) == 1


def test_math_conclusion_attached_without_losing_any_lines():
    values = lines(["Theorem 1. The set is", "x + y = z", "Then the set is convex."])
    blocks = [RawBlock(lines=[line], column=0, page_idx=0, page_num=1) for line in values]
    result = extend_math_blocks(blocks, 10, BODY)
    assert len(result) == 1
    assert [line.text for line in result[0].lines] == [line.text for line in values]


@pytest.mark.parametrize("boundary", ["column", "page", "gap", "heading"])
def test_math_merge_respects_boundaries(boundary):
    values = lines(["Theorem 1. The set is", "x + y = z"])
    blocks = [RawBlock(lines=[line], column=0, page_idx=0, page_num=1) for line in values]
    if boundary == "column": blocks[1].column = 1
    elif boundary == "page": blocks[1].page_idx = 1
    elif boundary == "gap":
        x0, y0, x1, y1 = values[1].bbox
        values[1].bbox = (x0, y0+100, x1, y1+100)
    else: values[1].text = "Proof. The result follows."
    assert len(extend_math_blocks(blocks, 10, BODY)) == 2


def test_lone_heading_does_not_steal_next_heading():
    values = lines(["Lemma 1.", "Proof. The argument follows."])
    assert len(group_lines_into_blocks(values, PAGE_W, 800, 1, False, BODY)) == 2


def test_original_fold_assignments_preserved_after_counts_change():
    blocks, split = inputs()
    mapping = {group: index for index, group in enumerate(split["train_groups"])}
    rows, report = prepare(blocks, split, source_folds=mapping)
    assert all(row["fold"] == mapping[row["group"]] for row in rows)
    assert original_folds(report, split) == mapping
    with pytest.raises(ValueError): prepare(blocks, split, source_folds={"a": 0})
    report["folds"][0]["groups"].append("held")
    with pytest.raises(ValueError): original_folds(report, split)


def test_quality_summary_uses_content_not_shifted_block_indices():
    blocks, split = inputs()
    rows, report = prepare(blocks, split)
    changed = [{**row, "block_id": row["block_id"] + "new"} for row in rows]
    summary = quality_summary(rows, changed, report, report, split)
    assert summary["exact_content_overlap"] == len(rows)
    assert summary["source_folds_preserved"] and not summary["test_evaluated"]
    changed[0]["fold"] = (changed[0]["fold"] + 1) % 5
    with pytest.raises(ValueError): quality_summary(rows, changed, report, report, split)
