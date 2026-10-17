"""Index a document's OKF concepts so /query can retrieve and cite them.

Bundles are built by POST /bundle but stored and verified in the browser, so
the reader's copy is the one that counts: the Knowledge panel sends it here
after every build, rebuild or verification. Each call replaces all concepts of
that PDF. A concept is searched by its title, description, defining sentence
and body, the same text ml/eval/hybrid_eval.py scored in ML3.4.
"""

import hashlib
import re
import uuid
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter
from pydantic import BaseModel
from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue, PointStruct

import store
import margin_ml  # noqa: F401
from ml.retrieval.links import concept_uses

router = APIRouter()


class ConceptIn(BaseModel):
    path: str
    type: str
    title: str
    description: str = ""
    page: int
    bbox: Optional[Dict[str, float]] = None
    # The concept's Markdown file; its body is part of the searchable text.
    markdown: str = ""
    # OKF `verified` entries, or a plain flag.
    verified: Union[bool, List[Dict[str, Any]], None] = None


class ConceptIndexRequest(BaseModel):
    docId: str
    pdfFingerprint: str
    concepts: List[ConceptIn]


class ConceptIndexResponse(BaseModel):
    pdfFingerprint: str
    indexed: int
    verified: int


def concept_text(title, description, markdown):
    """Title, description, defining sentence and body (proof and uses excluded)."""
    rest = markdown
    if markdown.startswith("---"):
        parts = re.split(r"^---\s*$", markdown, maxsplit=2, flags=re.M)
        rest = parts[2] if len(parts) == 3 else ""
    rest = rest.lstrip()
    sentence, body = None, rest
    if rest.startswith("> "):
        sentence, _, body = rest.partition("\n")
        sentence = sentence[2:]
    body = body.split("\n# Proof\n")[0].split("\n# Uses\n")[0].strip()
    return " ".join(part for part in (title, description, sentence, body) if part)


def point_id(fingerprint, path):
    return str(uuid.UUID(bytes=hashlib.sha256(f"okf|{fingerprint}|{path}".encode()).digest()[:16]))


def _fingerprint_filter(fingerprint):
    return Filter(must=[FieldCondition(key="pdfFingerprint", match=MatchValue(value=fingerprint))])


def index_concepts(req: ConceptIndexRequest, encode=None) -> ConceptIndexResponse:
    if encode is None:
        from embedder import get_embeddings as encode
    store.ensure_collection(store.CONCEPTS)
    client = store.get_qdrant()
    client.delete(store.CONCEPTS, points_selector=FilterSelector(filter=_fingerprint_filter(req.pdfFingerprint)))
    verified = 0
    if req.concepts:
        texts = [concept_text(c.title, c.description, c.markdown) for c in req.concepts]
        points = []
        for concept, text, vector in zip(req.concepts, texts, encode(texts)):
            is_verified = bool(concept.verified)
            verified += is_verified
            points.append(PointStruct(id=point_id(req.pdfFingerprint, concept.path), vector=list(vector), payload={
                "docId": req.docId, "pdfFingerprint": req.pdfFingerprint, "page": concept.page,
                "bbox": concept.bbox, "text": text, "conceptPath": concept.path, "type": concept.type,
                "title": concept.title, "verified": is_verified, "uses": concept_uses(concept.markdown)}))
        client.upsert(store.CONCEPTS, points=points)
    store.changed()
    return ConceptIndexResponse(pdfFingerprint=req.pdfFingerprint, indexed=len(req.concepts), verified=verified)


@router.post("/concepts", response_model=ConceptIndexResponse)
def concepts_endpoint(req: ConceptIndexRequest):
    return index_concepts(req)


@router.delete("/concepts/{fingerprint}")
def delete_concepts(fingerprint: str):
    client = store.get_qdrant()
    if client.collection_exists(store.CONCEPTS):
        client.delete(store.CONCEPTS, points_selector=FilterSelector(filter=_fingerprint_filter(fingerprint)))
        store.changed()
    return {"pdfFingerprint": fingerprint, "deleted": True}
