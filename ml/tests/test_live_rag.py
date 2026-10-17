"""ML3.5: the live /query retrieval path, on in-memory Qdrant with a toy encoder."""

import hashlib
import sys
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("qdrant_client")
from qdrant_client import QdrantClient  # noqa: E402
from qdrant_client.models import PointStruct  # noqa: E402

sys.path.append(str(Path(__file__).resolve().parents[2] / "local-llm" / "rag-api"))
import concepts_api  # noqa: E402
import ingest  # noqa: E402
import prompt  # noqa: E402
import retriever  # noqa: E402
import store  # noqa: E402
from schemas import QueryScope  # noqa: E402

from ml.eval.okf_sample import read_concept  # noqa: E402


def encode_one(text):
    """Hashed bag of words: texts sharing words get similar vectors."""
    vector = np.zeros(store.DIMENSION)
    for word in text.lower().split():
        vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % store.DIMENSION] += 1
    return (vector + 1e-3).tolist()


def encode(texts):
    return [encode_one(text) for text in texts]


MARKDOWN = """---
type: Definition
title: Bipartite graph
status: draft
---

> A graph is called bipartite if its vertices split into two classes.

Every edge joins the two classes.

# Uses

- [Graph](/definitions/graph.md)
"""


@pytest.fixture
def memory(monkeypatch):
    store.set_qdrant(QdrantClient(":memory:"))
    monkeypatch.setattr(retriever, "get_embedding", encode_one)
    store.ensure_collection(store.PASSAGES)
    passages = [("doc-1", "fp-1", 1, "Graphs have vertices and edges joining them."),
                ("doc-1", "fp-1", 2, "Colouring a graph assigns colours to its vertices."),
                ("doc-1", "fp-1", 3, "Trees are connected graphs without cycles."),
                ("doc-2", "fp-2", 1, "A bipartite matching pairs workers with jobs.")]
    store.get_qdrant().upsert(store.PASSAGES, points=[
        PointStruct(id=i, vector=encode_one(text), payload={"docId": doc, "pdfFingerprint": fp, "page": page,
                                                            "text": text, "bbox": [0.1, 0.1, 0.9, 0.2]})
        for i, (doc, fp, page, text) in enumerate(passages)])
    store.changed()
    yield
    store.set_qdrant(None)


def concept_request(verified=None, path="definitions/bipartite-graph.md"):
    return concepts_api.ConceptIndexRequest(docId="stable-1", pdfFingerprint="fp-1", concepts=[concepts_api.ConceptIn(
        path=path, type="Definition", title="Bipartite graph",
        description="A graph whose vertices split into two classes.", page=2,
        bbox={"x0": 0.1, "y0": 0.4, "x1": 0.9, "y1": 0.5}, markdown=MARKDOWN, verified=verified)])


def test_concept_text_matches_the_evaluated_text(tmp_path):
    path = tmp_path / "c.md"
    path.write_text(MARKDOWN, encoding="utf-8")
    meta, sentence, body, _ = read_concept(path)
    expected = " ".join(p for p in ("Bipartite graph", "A graph whose vertices split into two classes.", sentence, body) if p)
    assert concepts_api.concept_text("Bipartite graph", "A graph whose vertices split into two classes.", MARKDOWN) == expected
    assert "Uses" not in expected and "is called bipartite" in expected


def test_concept_text_without_frontmatter():
    assert concepts_api.concept_text("T", "", "Body only.") == "T Body only."


def test_indexing_replaces_a_documents_concepts(memory):
    first = concepts_api.index_concepts(concept_request(verified=[{"by": "human:local", "at": "2026-10-14T00:00:00Z"}]),
                                        encode)
    assert (first.indexed, first.verified) == (1, 1)
    concepts_api.index_concepts(concept_request(path="definitions/other.md"), encode)
    points, _ = store.get_qdrant().scroll(store.CONCEPTS, limit=10)
    assert [p.payload["conceptPath"] for p in points] == ["definitions/other.md"]
    assert points[0].payload["verified"] is False


def test_hybrid_concepts_returns_citable_concepts(memory):
    concepts_api.index_concepts(concept_request(verified=True), encode)
    # Scoped by fingerprint: the concept was indexed under a different document id.
    found = retriever.retrieve("what is a bipartite graph", 5, QueryScope(docIds=["fp-1"]), "hybrid_concepts")
    assert found[0]["kind"] == "concept"
    assert found[0]["title"] == "Bipartite graph" and found[0]["verified"] is True
    assert found[0]["page"] == 2 and found[0]["bbox"]["y0"] == 0.4
    assert {item["pdfFingerprint"] for item in found} == {"fp-1"}
    assert all(a["score"] >= b["score"] for a, b in zip(found, found[1:]))


def test_concepts_join_passages_by_fingerprint(memory):
    # The chat scopes by the ingest id ("doc-1"); the concept was indexed as "stable-1".
    concepts_api.index_concepts(concept_request(), encode)
    found = retriever.retrieve("what is a bipartite graph", 5, QueryScope(docIds=["doc-1"]), "hybrid_concepts")
    assert found[0]["kind"] == "concept" and found[0]["docId"] == "stable-1"
    # A concept of another PDF never leaks in.
    other = retriever.retrieve("what is a bipartite graph", 5, QueryScope(docIds=["doc-2"]), "hybrid_concepts")
    assert all(item["kind"] == "passage" for item in other)


def test_hybrid_without_concepts_and_page_scope(memory):
    concepts_api.index_concepts(concept_request(), encode)
    found = retriever.retrieve("bipartite graph", 5, QueryScope(docIds=["doc-1"], pages=[1, 3]), "hybrid")
    assert found and all(item["kind"] == "passage" and item["page"] in (1, 3) for item in found)


def test_index_is_rebuilt_after_a_write(memory):
    scope = QueryScope(docIds=["fp-1"])
    assert all(i["kind"] == "passage" for i in retriever.retrieve("bipartite", 5, scope, "hybrid_concepts"))
    concepts_api.index_concepts(concept_request(), encode)
    assert any(i["kind"] == "concept" for i in retriever.retrieve("bipartite", 5, scope, "hybrid_concepts"))


def test_unscoped_queries_fall_back_to_dense(memory):
    found = retriever.retrieve("bipartite matching workers jobs", 2, None, "hybrid_concepts")
    assert found[0]["docId"] == "doc-2" and found[0]["page"] == 1


def test_unknown_method_is_rejected(memory):
    with pytest.raises(ValueError):
        retriever.retrieve("x", 2, None, "sparse")


def test_last_page_uses_all_scoped_passages_not_returned_candidates(memory):
    scope = QueryScope(docIds=["doc-1"])
    found = retriever.retrieve("Graphs have vertices and edges joining them.", 1, scope, "hybrid")
    assert found[0]["page"] == 1
    assert found[0]["last_page"] == 3
    store.get_qdrant().upsert(store.PASSAGES, points=[PointStruct(
        id=100, vector=encode_one("unrelated appendix"),
        payload={"docId": "doc-1", "pdfFingerprint": "fp-1", "page": 9, "text": "unrelated appendix"})])
    store.changed()
    updated = retriever.retrieve("Graphs have vertices and edges joining them.", 1, scope, "hybrid")
    assert updated[0]["page"] == 1 and updated[0]["last_page"] == 9


def test_status_counts_ingested_chunks(memory):
    assert ingest.check_status("fp-1").chunkCount == 3
    assert ingest.check_status("missing").ingested is False


def test_prompt_labels_concepts_and_pages():
    concept = {"kind": "concept", "type": "Definition", "title": "Bipartite graph", "page": 2, "verified": True}
    assert prompt.source_label(concept) == '(Definition "Bipartite graph", page 2, verified by the reader)'
    assert prompt.source_label({"kind": "passage", "page": 4}) == "(page 4)"
    assert "[1] (page 4) text" in prompt.build_prompt("q", [{"kind": "passage", "page": 4, "text": "text"}])


class StubCrossEncoder:
    def predict(self, pairs):
        return [float(len(text)) for _, text in pairs]  # longer text = more relevant


class StubRanker:
    def predict(self, rows):
        return [-row[0] for row in rows]  # prefers low BM25, the opposite of the signals


def candidates():
    return [dict(text="x" * n, kind="passage", page=n, bm25=float(n), bm25_rank=4 - n, cosine=0.5, dense_rank=n,
                 fused_rank=n, score=0.01, last_page=3) for n in (1, 2, 3)]


def test_cross_encoder_mode_keeps_logit_scale_and_boosts_verified(monkeypatch):
    import reranker
    monkeypatch.setattr(reranker, "_cross_encoder", StubCrossEncoder())
    items = candidates()
    items[0]["verified"] = True
    ranked = reranker.rerank("q", items, 3, mode="cross_encoder")
    assert [c["page"] for c in ranked] == [3, 1, 2]  # 1 + boost 1.0 = 2.0 ties 2, stable order keeps page 1 first
    assert ranked[0]["relevance_score"] == 3.0 and ranked[0]["cross_encoder"] == 3.0


def test_ranker_mode_orders_by_the_model(monkeypatch):
    import reranker
    monkeypatch.setattr(reranker, "_cross_encoder", StubCrossEncoder())
    monkeypatch.setattr(reranker, "_ranker", StubRanker())
    ranked = reranker.rerank("q", candidates(), 3, mode="ranker")
    assert [c["page"] for c in ranked] == [1, 2, 3]
    assert ranked[0]["relevance_score"] == 1.0  # confidence still reads the cross-encoder logit
    # Dense-only candidates carry no signals: cross-encoder order.
    plain = [{"text": "x" * n, "kind": "passage", "page": n} for n in (1, 2, 3)]
    assert [c["page"] for c in reranker.rerank("q", plain, 3, mode="ranker")] == [3, 2, 1]
