"""Candidate retrieval for /query.

RETRIEVAL selects the method (ML3.4 compared them on the training questions):
  hybrid_concepts  (default) BM25 and dense rankings over the scoped passages
                   and the PDF's OKF concepts, fused with reciprocal rank
                   fusion (ml/retrieval/hybrid.py); a concept carries its page
                   and region, so it can be cited like a passage
  hybrid           the same without concepts
  dense            Qdrant nearest neighbours over passages, the earlier behaviour
BM25 needs the whole scoped set, so the hybrid methods read the scoped points
(with their stored vectors) once and keep the index until the next write.
Without a document scope they fall back to dense search over the library.
"""

import os

from qdrant_client.models import FieldCondition, Filter, MatchAny

import margin_ml  # noqa: F401  (puts ml/ on the path)
import store
from embedder import get_embedding
from ml.retrieval.hybrid import HybridRetriever, cosine_scores, rrf_scored
from schemas import QueryScope

RETRIEVAL = os.getenv("RETRIEVAL", "hybrid_concepts")
METHODS = ("dense", "hybrid", "hybrid_concepts")
DEPTH = 50
_indexes = {}


def scope_filter(scope, fingerprints=()):
    must = []
    if scope and scope.docIds:
        # Clients send session ids, stable ids or fingerprints; match either field.
        must.append(Filter(should=[FieldCondition(key="docId", match=MatchAny(any=scope.docIds)),
                                   FieldCondition(key="pdfFingerprint",
                                                  match=MatchAny(any=[*scope.docIds, *fingerprints]))]))
    if scope and scope.pages:
        must.append(FieldCondition(key="page", match=MatchAny(any=scope.pages)))
    return Filter(must=must) if must else None


def to_item(point, kind):
    payload = point.payload or {}
    item = {"kind": kind, "text": payload.get("text", ""), "docId": payload.get("docId"),
            "pdfFingerprint": payload.get("pdfFingerprint"),
            "page": payload.get("page", payload.get("pageNumber")), "bbox": payload.get("bbox")}
    if kind == "concept":
        item.update(title=payload.get("title"), type=payload.get("type"),
                    conceptPath=payload.get("conceptPath"), verified=bool(payload.get("verified")))
    return item


def scroll(collection, flt):
    client = store.get_qdrant()
    if not client.collection_exists(collection):
        return []
    points, offset = [], None
    while True:
        batch, offset = client.scroll(collection, scroll_filter=flt, limit=512, offset=offset,
                                      with_payload=True, with_vectors=True)
        points.extend(batch)
        if offset is None:
            return points


def hybrid_index(scope, with_concepts):
    key = (repr(scope_filter(scope)), with_concepts, store.generation)
    if key not in _indexes:
        points = [(p, "passage") for p in scroll(store.PASSAGES, scope_filter(scope))]
        if with_concepts:
            # The Knowledge panel indexes concepts under its own document id, which
            # need not be the id the chat scopes by; the PDF fingerprint joins them.
            fingerprints = sorted({p.payload.get("pdfFingerprint") for p, _ in points} - {None})
            points += [(p, "concept") for p in scroll(store.CONCEPTS, scope_filter(scope, fingerprints))]
        items = [to_item(p, kind) for p, kind in points]
        _indexes.clear()  # one scope at a time is enough for a single reader
        index = HybridRetriever(items, [p.vector for p, _ in points], depth=DEPTH) if items else None
        if index:
            index.last_page = {}
            for item in items:
                if item["kind"] == "passage" and item["page"]:
                    fingerprint = item["pdfFingerprint"]
                    index.last_page[fingerprint] = max(index.last_page.get(fingerprint, 0), item["page"])
        _indexes[key] = index
    return _indexes[key]


def with_signals(index, question, query_vector, top_k):
    """Fused candidates with their BM25/dense scores and ranks (for the ML4 ranker)."""
    lexical = index.bm25.scores(question)
    cosine = cosine_scores(index.vectors, query_vector)
    ranked = index.rankings(question, query_vector)
    position = {name: {i: r for r, i in enumerate(order, 1)} for name, order in ranked.items()}
    fused = rrf_scored([ranked["bm25"], ranked["dense"]], index.k)[:top_k]
    return [dict(index.items[i], score=score, fused_rank=rank, bm25=float(lexical[i]), cosine=float(cosine[i]),
                 bm25_rank=position["bm25"].get(i, index.depth + 1),
                 dense_rank=position["dense"].get(i, index.depth + 1),
                 last_page=index.last_page.get(index.items[i]["pdfFingerprint"]))
            for rank, (i, score) in enumerate(fused, 1)]


def dense(query_vector, top_k, scope):
    client = store.get_qdrant()
    if not client.collection_exists(store.PASSAGES):
        return []
    hits = client.query_points(store.PASSAGES, query=query_vector, query_filter=scope_filter(scope), limit=top_k).points
    return [dict(to_item(p, "passage"), score=p.score) for p in hits]


def retrieve(question: str, top_k: int = 8, scope: QueryScope = None, method: str = None):
    method = method or RETRIEVAL
    if method not in METHODS:
        raise ValueError(f"RETRIEVAL must be one of {METHODS}")
    print(f"[Retriever] {method} query: {question}, scope: {scope}")
    query_vector = get_embedding(question)
    try:
        if method == "dense" or not (scope and scope.docIds):
            return dense(query_vector, top_k, scope)
        index = hybrid_index(scope, method == "hybrid_concepts")
        if index is None:
            return []
        return with_signals(index, question, query_vector, top_k)
    except Exception as e:
        print(f"[Retriever] Error: {e}")
        return []
