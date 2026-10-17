"""One-hop policy and paired evaluation, without real models or PDF data."""

import copy

import pytest

from ml.retrieval.links import concept_uses, expand_one_hop


def concept(path, kind="Definition", fingerprint="a", uses=()):
    return {"kind": "concept", "type": kind, "pdfFingerprint": fingerprint,
            "conceptPath": path, "uses": list(uses)}


def test_parse_only_uses_section_and_canonical_local_paths():
    markdown = """# Proof
- [Not a dependency](/proof.md)
# Uses
- [One](/definitions/one.md)
- [One repeated](definitions/one.md)
- [Encoded](/definitions/two%2Dwords.md)
# Other
- [Not a dependency](/other.md)
"""
    assert concept_uses(markdown.replace("\n", "\r\n")) == ["definitions/one.md", "definitions/two-words.md"]
    assert concept_uses("Body [link](/one.md)") == []


@pytest.mark.parametrize("target", ["https://other/one.md", "//other/one.md", "http://[", "../one.md",
                                    "/definitions/../one.md", "/%2e%2e/one.md", "/one.md?x=1", "/one.md#x",
                                    "/definitions\\one.md", "/definitions//one.md", "/one.txt", "/%0aone.md"])
def test_reject_external_ambiguous_and_traversal_links(target):
    assert concept_uses(f"# Uses\n- [Bad]({target})\n") == []


def test_expansion_protects_prefix_caps_links_and_budget_without_mutation():
    items = [concept("theorem.md", "Theorem", uses=[f"d{i}.md" for i in range(6)])]
    items += [{"kind": "passage"} for _ in range(23)]
    items += [concept(f"d{i}.md") for i in range(6)]
    original = copy.deepcopy(items)
    order, reached = expand_one_hop(items, range(24), 24)
    assert order == list(range(20)) + [24, 25, 26, 27]
    assert reached == {24, 25, 26, 27}
    assert len(order) == len(set(order)) == 24
    assert items == original


def test_scope_type_cycles_and_duplicates():
    items = [concept("theorem.md", "Theorem", uses=["one.md", "one.md", "proof.md", "missing.md"]),
             {"kind": "passage"}, {"kind": "passage"},
             concept("one.md", "Definition", "other"),
             concept("one.md", uses=["two.md", "theorem.md"]),
             concept("proof.md", "Proof"), concept("two.md")]
    order, reached = expand_one_hop(items, [0, 1, 2], 3, seed_count=1)
    assert order == [0, 1, 4] and reached == {4}
    assert 3 not in order and 5 not in order and 6 not in order


def test_already_retrieved_dependencies_are_not_duplicated_or_discarded():
    items = [concept("t.md", "Lemma", uses=["one.md", "two.md"]), {"kind": "passage"},
             concept("one.md", "Notation"), concept("two.md")]
    order, reached = expand_one_hop(items, [0, 1, 2], 3, seed_count=1)
    assert order == [0, 2, 3] and reached == {2, 3}


def test_only_original_result_prefix_seeds_expand_and_small_budgets_are_safe():
    items = [{"kind": "passage"}, concept("t.md", "Theorem", uses=["d.md"]), concept("d.md")]
    assert expand_one_hop(items, [0, 1], 2, seed_count=1) == ([0, 1], set())
    assert expand_one_hop(items, [1], 1) == ([1], set())
    assert expand_one_hop(items, [1], 0) == ([], set())


def test_no_valid_links_preserves_candidate_order():
    items = [concept("t.md", "Theorem", fingerprint=None, uses=["d.md"]), concept("d.md")]
    assert expand_one_hop(items, [0, 1], 3, seed_count=1) == ([0, 1], set())


def result(qid, file, value):
    from ml.eval.link_expansion_eval import METHODS, METRICS
    return {"qid": qid, "file": file, **{method: dict.fromkeys(METRICS, value) for method in METHODS}}


def test_seed_averaging_keeps_questions_paired_then_bootstraps_documents():
    from ml.eval.link_expansion_eval import average_seeds, paired_results
    runs = [[result("a", "doc-a", 0), result("b", "doc-b", 0.5)],
            [result("b", "doc-b", 1.0), result("a", "doc-a", 0.5)]]
    averaged = average_seeds(runs)
    assert averaged[0]["lambdarank"]["mrr_at_10"] == 0.25
    assert averaged[1]["lambdarank"]["mrr_at_10"] == 0.75
    paired = paired_results([result("b", "doc-b", 0.5), result("a", "doc-a", 0)], averaged)
    assert paired["lambdarank"]["mrr_at_10"]["value"] == 0.25
    assert paired["lambdarank"]["mrr_at_10"]["ci95"] == [0.25, 0.25]
    with pytest.raises(ValueError, match="same questions"):
        paired_results(runs[0], [result("unknown", "doc-a", 0), runs[0][1]])


def test_development_evaluator_rejects_frozen_read_before_loading(monkeypatch):
    from ml.eval import link_expansion_eval
    monkeypatch.setattr("sys.argv", ["link_expansion_eval", "--out", "unused.json", "--frozen-test-milestone"])
    monkeypatch.setattr(link_expansion_eval, "load_questions", lambda *args: pytest.fail("Must not read questions"))
    with pytest.raises(SystemExit, match="inference-only"):
        link_expansion_eval.main()


def test_development_evaluator_requires_cache_before_loading(tmp_path, monkeypatch):
    from ml.eval import link_expansion_eval
    monkeypatch.setattr("sys.argv", ["link_expansion_eval", "--out", "unused.json", "--require-cache",
                                     "--groups", str(tmp_path / "missing.json")])
    monkeypatch.setattr(link_expansion_eval, "load_questions", lambda *args: pytest.fail("Must not read questions"))
    with pytest.raises(SystemExit, match="existing candidate cache"):
        link_expansion_eval.main()


def test_paired_candidates_share_raw_ce_logits_but_keep_distinct_identity(monkeypatch):
    from ml.eval import link_expansion_eval
    from ml.ranking.features import FEATURES
    import retriever
    import reranker

    calls = []

    class Encoder:
        def predict(self, pairs):
            calls.append(pairs)
            return [float(i) for i, _ in enumerate(pairs)]

    def item(text, kind="passage", path=None, reached=False):
        return {"text": text, "kind": kind, "conceptPath": path, "type": "Definition", "verified": True,
                "pdfFingerprint": "a", "page": 1, "score": 0.02, "bm25": 1.0, "bm25_rank": 1,
                "cosine": 0.5, "dense_rank": 1, "fused_rank": 1, "last_page": 2, "reached_by_link": reached}

    def retrieve(question, limit, scope, method):
        assert limit == 24 and scope.docIds == ["a.pdf"]
        if method == "hybrid_concepts":
            return [item("same"), item("other")]
        assert method == "hybrid_concepts_links"
        return [item("same"), item("same", "concept", "definition.md", True)]

    monkeypatch.setattr(retriever, "retrieve", retrieve)
    monkeypatch.setattr(reranker, "get_cross_encoder", lambda: Encoder())
    q = {"qid": "q", "file": "a.pdf", "question": "query", "answer_pages": [1], "answer_quote": "same"}
    groups, diagnostics = link_expansion_eval.build_groups([q])
    assert calls == [[["query", "same"], ["query", "other"]]]
    assert diagnostics[0]["new_candidates"] == 1
    assert diagnostics[0]["on"]["linked"] == 1
    ce = FEATURES.index("cross_encoder")
    assert groups["off"][0]["features"][0][ce] == groups["on"][0]["features"][1][ce] == 0.0
    assert groups["on"][0]["labels"] == [2, 2]
