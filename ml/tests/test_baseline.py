"""No model downloads: metric, cluster-bootstrap and legacy-import invariants."""

import numpy as np
import pytest

from ml.eval.baseline_current_rag import cosine_order, evaluate, load_chunker, metrics, pdf_chunks, report_results
from ml.eval.stats import document_bootstrap


def test_document_bootstrap_samples_clusters_not_questions():
    values = {"long": [1.0]*20, "short": [0.0]}
    result = document_bootstrap(values)
    assert result["value"] == 20/21
    assert result["ci95"] == [0,1]
    assert result == document_bootstrap(dict(reversed(list(values.items()))))


def test_constant_and_single_document_intervals():
    assert document_bootstrap({"one": [.5,.5]})["ci95"] == [.5,.5]
    assert document_bootstrap({"one": [0,1]})["ci95"] == [.5,.5]
    with pytest.raises(ValueError):
        document_bootstrap({})


def test_metrics_separate_top5_hit_from_top10_reciprocal_rank():
    chunks = [{"page":i} for i in range(1,11)]
    assert metrics(chunks,[7]) == {"recall_at_5":0,"mrr_at_10":1/7}
    assert metrics(chunks,[2,7]) == {"recall_at_5":1,"mrr_at_10":.5}
    assert metrics(chunks,[11])["mrr_at_10"] == 0


def test_cosine_normalisation_stable_ties_and_zero_vectors():
    assert cosine_order([[10,0],[2,0],[0,1],[0,0]],[1,0]) == [0,1,2,3]


def test_evaluation_reranks_and_excludes_unanswerable():
    chunks = {"a.pdf":[{"page":i,"text":str(i)} for i in range(1,9)]}
    q = {"file":"a.pdf","split":"test","answer_pages":[7],"question":"query","answerable":True}
    results = evaluate([q,dict(q,answerable=False)], chunks,
                       lambda texts: np.ones((len(texts),2)),
                       lambda pairs: [1 if text == '7' else 0 for _,text in pairs])
    assert len(results) == 1
    assert results[0]["vector"]["recall_at_5"] == 0
    assert results[0]["reranked"]["recall_at_5"] == 1
    assert report_results(results)["train"]["vector"]["recall_at_5"] is None


def test_legacy_chunker_import_and_native_pdf_provenance(tmp_path):
    import pymupdf
    chunker = load_chunker()
    # Importing the chunker must not open Qdrant (the service's store creates it on use).
    assert chunker.__globals__["store"]._client is None
    path = tmp_path / "fixture.pdf"
    with pymupdf.open() as document:
        document.new_page().insert_textbox((30,30,500,700), "A mathematical statement with enough words. " * 20)
        document.save(path)
    chunks = pdf_chunks(path, chunker)
    assert chunks and all(chunk["page"] == 1 and chunk["docId"] == "fixture.pdf" for chunk in chunks)


def test_empty_chunks_score_zero_and_bad_rerank_length_rejected():
    q = {"file":"a","split":"train","question":"q","answerable":True,"answer_pages":[1]}
    assert evaluate([q],{"a":[]},lambda texts:[],lambda pairs:[])[0]["vector"]["recall_at_5"] == 0
    with pytest.raises(ValueError, match="number"):
        evaluate([q],{"a":[{"text":"a","page":1}]},lambda texts:[[1]],lambda pairs:[])


def test_qdrant_factory_is_lazy_and_reused(monkeypatch):
    store = load_chunker().__globals__["store"]
    created = []
    def factory(**kwargs):
        client = object()
        created.append(client)
        return client
    monkeypatch.setattr(store, "QdrantClient", factory)
    monkeypatch.setattr(store, "_client", None)
    first = store.get_qdrant()
    assert store.get_qdrant() is first and created == [first]
