"""Synthetic provenance and qualification checks; no corpus/model access."""

import copy

import pytest

from ml.retrieval import coherent_contexts as c, focused_contexts as f


def source(text, *, title="", page=3, doc="one", kind=None):
    return {"text": text, "title": title, "page": page, "docId": doc,
            **({"kind": kind} if kind else {})}


def test_common_source_unifies_split_claim_and_exception_in_source_order():
    a = source("Rule Rule A rule is required at a local minimum.", title="Rule", kind="concept")
    b = source("A rule is required at a local minimum. These conditions are not sufficient. However, convex problems are an exception.")
    items = [a, {**b, "text": "These conditions are not sufficient."}]
    merged = c.carrier_window(items, [a, b], window_bytes=1000)
    assert merged["text"] == "A rule is required at a local minimum.\nThese conditions are not sufficient.\nHowever, convex problems are an exception."
    assert merged["docId"] == "one" and "kind" not in merged


@pytest.mark.parametrize("change", [{"page": 4}, {"docId": "two"}, {"docId": None}, {"pdfFingerprint": "two"}, {"page": True}])
def test_page_or_document_mismatch_cannot_merge(change):
    a = source("Marker is required.")
    b = {**source("Marker is required. It is not sufficient."), **change}
    assert c.carrier_window([a, b], [a, b], window_bytes=1000) is None


def test_same_page_does_not_imply_adjacency_or_authorize_synthetic_concatenation():
    a, b = source("Alpha is a token."), source("Beta is a container.")
    assert c.carrier_window([a, b], [a, b], window_bytes=1000) is None
    carrier = source("Alpha is a token. First unrelated sentence. Second unrelated sentence. Beta is a container.")
    assert c.carrier_window([a, b], [carrier], window_bytes=1000) is None


def test_every_original_fact_must_match_without_erasing_negation_or_case():
    a = source("A mark is not reversible.")
    assert c.carrier_window([a], [source("A mark is reversible.")], window_bytes=1000) is None
    assert c.carrier_window([source("Token X is fixed.")], [source("Token x is fixed.")], window_bytes=1000) is None


def test_one_intervening_sentence_is_retained_instead_of_claiming_direct_adjacency():
    raw = source("Alpha is a token. A nearby explanatory sentence. Beta is a container.")
    result = c.carrier_window([source("Alpha is a token."), source("Beta is a container.")], [raw], window_bytes=1000)
    assert result["text"] == raw["text"].replace(". ", ".\n")


def test_natural_title_subject_and_math_are_preserved():
    a = source("Marker is denoted ε, not Σ.", title="Marker", kind="concept")
    assert c.units(a) == [a["text"]]
    assert c.carrier_window([a], [a], window_bytes=100)["text"] == a["text"]


def test_integration_keeps_all_selected_facts_and_uses_actual_carrier_metadata(monkeypatch):
    a = source("Rule Rule A rule is required.", title="Rule", kind="concept")
    b = source("A rule is required. These conditions are not sufficient. However, an exception applies.")
    selected = [a, {**b, "text": "These conditions are not sufficient."}]
    monkeypatch.setattr(f, "select_contexts", lambda *args, **kwargs: copy.deepcopy(selected))
    raw = [a, b]
    before = copy.deepcopy(raw)
    result = c.select_contexts("Is the rule sufficient?", raw)
    assert len(result) == 1 and "kind" not in result[0]
    assert all(c.compact(unit) in c.compact(result[0]["text"]) for item in selected for unit in c.units(item))
    assert raw == before


def test_total_utf8_budget_falls_back_without_dropping_selected_evidence(monkeypatch):
    a = source("Marker is ε.")
    extra = source("Marker is ε. However, this is a qualification that requires more bytes.")
    other = source("Another independent claim.", page=4)
    selected = [a, other]
    monkeypatch.setattr(f, "select_contexts", lambda *args, **kwargs: copy.deepcopy(selected))
    limit = sum(len(x["text"].encode()) for x in selected)
    assert c.select_contexts("Marker?", [extra, other], byte_budget=limit) == selected


def test_long_atomic_sentence_keeps_original_fallback_and_limits_are_validated():
    text = "Marker is " + "long "*300 + "unless qualified."
    raw = [source(text, title="Marker", kind="concept")]
    assert c.select_contexts("What is Marker?", raw)[0]["text"] == text
    with pytest.raises(ValueError):
        c.select_contexts("What?", raw, byte_budget=0)
    assert c.select_contexts("What?", []) == []
