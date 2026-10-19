"""Model-free synthetic evidence-window tests; no corpus or label access."""

import copy

import pytest

from ml.retrieval.focused_contexts import SEPARATOR, select_contexts, sentences, terms


def concept(title, text, page=1):
    return {"kind": "concept", "title": title, "type": "Definition", "text": text, "page": page}


def test_named_definition_leads_background_and_selector_does_not_fill_budget():
    raw = [{"text": "Repeated glyphs occur in an unrelated pumping argument. "*30, "page": 99},
           concept("glyph", "glyph glyph A glyph is a visible symbol. A glyph can have varied shapes.", 4)]
    before = copy.deepcopy(raw)
    selected = select_contexts("How does this text define a glyph?", raw)
    assert selected[0]["page"] == 4 and "visible symbol" in selected[0]["text"]
    assert len(selected) == 1
    assert sum(len(c["text"].encode()) for c in selected) < 4000
    assert raw == before and selected == select_contexts("How does this text define a glyph?", raw)


def test_both_complementary_concept_definitions_are_preserved_without_gold():
    raw = [concept("codec", "codec A codec is a conversion procedure."),
           concept("container", "container A container is a package holding encoded records.", 2),
           {"text": "The codec appears in many examples. "*20, "page": 9}]
    selected = select_contexts("How does a codec differ from a container?", raw)
    assert {c.get("title") for c in selected} == {"codec", "container"}
    assert "conversion procedure" in " ".join(c["text"] for c in selected)
    assert "package holding" in " ".join(c["text"] for c in selected)


def test_early_defining_sentence_wins_over_later_keyword_dense_membership():
    raw = [concept("token", "token We define a token to be a discrete mark. The token members are token symbols and token examples.")]
    selected = select_contexts("What restrictions define a token of symbols?", raw)
    assert "discrete mark" in selected[0]["text"]


def test_qualification_and_negation_neighbor_are_not_silently_cut():
    raw = [concept("stationarity", "stationarity Stationarity is required at a local optimum. These requirements are not sufficient. However, convexity is an additional qualification.")]
    selected = select_contexts("Is stationarity required or sufficient at a local optimum?", raw)
    assert "is required" in selected[0]["text"]
    assert "not sufficient" in selected[0]["text"]
    assert all(unit in raw[0]["text"] for unit in selected[0]["text"].split(SEPARATOR))


def test_bullet_definitions_and_complete_body_replace_midword_truncated_metadata():
    raw = [concept("separator", "separator • A separator is a boundary marker. • A separator is drawn parallel becau… • A separator is a boundary marker. • A separator is drawn parallel because tests use one coordinate.")]
    selected = select_contexts("What is a separator and why is it parallel?", raw)
    text = selected[0]["text"]
    assert "boundary marker" in text and "one coordinate" in text and "becau…" not in text
    assert sentences(raw[0]).count("A separator is a boundary marker.") == 1


def test_utf8_budget_atomic_sentences_and_source_count_are_hard_limits():
    raw = [concept(f"marker {i}", f"Marker {i} is denoted ε Σ café.", i) for i in range(8)]
    selected = select_contexts("Which marker is denoted ε?", raw, byte_budget=90, max_sources=2)
    assert len(selected) <= 2 and sum(len(c["text"].encode()) for c in selected) <= 90
    assert all("�" not in c["text"] for c in selected)
    assert select_contexts("Σ", [{"text": "Σ."}], byte_budget=1) == []
    assert select_contexts("facts", []) == []
    with pytest.raises(ValueError):
        select_contexts("facts", raw, max_sources=0)


def test_atomic_long_sentence_preserves_qualification_without_word_truncation():
    text = "Marker is a " + "long "*300 + "qualification unless an exception applies."
    result = select_contexts("What marker qualification applies?", [concept("marker", text)], byte_budget=2000)
    assert result[0]["text"] == text
    assert select_contexts("What marker qualification applies?", [concept("marker", text)], byte_budget=1000) == []


def test_plural_normalization_is_search_only_and_preserves_notation():
    assert {"boundary", "class"} <= terms("boundaries and classes")
    raw = [concept("boundary", "A boundary is denoted Σ, not ε.")]
    result = select_contexts("Which boundaries use notation?", raw)
    assert result[0]["text"] == raw[0]["text"]


def test_missing_lexical_match_falls_back_to_first_ce_source_without_inventing_text():
    raw = [{"text": "An unrelated heading.", "page": 5}, {"text": "Another thing is described here.", "page": 9}]
    result = select_contexts("Who deployed nonceXYZ?", raw)
    assert len(result) == 1 and result[0]["page"] == 5
    assert result[0]["text"] in raw[0]["text"]


def test_duplicates_do_not_displace_complementary_fact_and_input_labels_are_unused():
    raw = [concept("compression", "Compression is a reversible mapping."),
           {"text": "Compression is a reversible mapping.", "page": 2, "answer_quote": "ORACLE SECRET"},
           {"text": "Mapping storage requires a header.", "page": 3}]
    selected = select_contexts("What compression mapping storage is required?", raw)
    text = " ".join(c["text"] for c in selected)
    assert text.count("Compression is a reversible mapping.") == 1
    assert "header" in text and "ORACLE SECRET" not in text


def test_broader_window_with_a_new_fact_is_not_discarded_as_a_duplicate():
    definition = "A codec is defined as a conversion rule."
    raw = [concept("codec", definition), {"text": definition + " Its cache resets after each packet.", "page": 2}]
    selected = select_contexts("How does the codec cache reset after packets?", raw)
    assert "Its cache resets after each packet." in " ".join(c["text"] for c in selected)
