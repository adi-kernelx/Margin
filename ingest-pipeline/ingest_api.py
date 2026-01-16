#!/usr/bin/env python3
"""
ingest_api.py
FastAPI service that receives OCR data and ingests it into Qdrant.
Runs alongside embedding and search services.

Endpoints:
- POST /ingest   - Ingest OCR data for a document
- GET /status    - Check if a document is already ingested
- GET /health    - Health check
"""

import hashlib
import json
import sqlite3
import uuid
import re
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance

# CONFIG
EMBEDDING_API = "http://localhost:9000/embed"
QDRANT_URL = "http://localhost:6333"
QDRANT_COLLECTION = "pdf_chunks"
MAX_CHARS_PER_CHUNK = 800
EMBEDDING_CACHE_DB = "embedding_cache.db"

app = FastAPI(title="Ingest API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = QdrantClient(url=QDRANT_URL)


# -------------------------
# Request/Response Models
# -------------------------
class OcrToken(BaseModel):
    text: str
    bbox: Dict[str, float]
    confidence: Optional[float] = None
    fontSizeNorm: Optional[float] = None


class OcrPageData(BaseModel):
    tokens: List[OcrToken]
    avgConfidence: Optional[float] = None
    detectedScript: Optional[str] = None


class IngestRequest(BaseModel):
    docId: str
    pdfFingerprint: str
    displayName: Optional[str] = None
    ocrData: Dict[str, OcrPageData]  # Key is page number as string


class IngestResponse(BaseModel):
    success: bool
    chunksIngested: int
    message: str
    cached: bool = False


class StatusResponse(BaseModel):
    ingested: bool
    chunkCount: int
    pdfFingerprint: str


# -------------------------
# Embedding Cache
# -------------------------
def get_db_connection():
    conn = sqlite3.connect(EMBEDDING_CACHE_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS embedding_cache (
            text_hash TEXT PRIMARY KEY,
            pdf_fingerprint TEXT,
            embedding TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ingested_docs (
            pdf_fingerprint TEXT PRIMARY KEY,
            doc_id TEXT,
            chunk_count INTEGER,
            ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pdf_fp ON embedding_cache(pdf_fingerprint)")
    conn.commit()
    return conn


def get_text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def get_cached_embedding(conn, text_hash: str) -> Optional[List[float]]:
    cursor = conn.execute("SELECT embedding FROM embedding_cache WHERE text_hash = ?", (text_hash,))
    row = cursor.fetchone()
    return json.loads(row[0]) if row else None


def cache_embedding(conn, text_hash: str, pdf_fingerprint: str, embedding: List[float]):
    conn.execute(
        "INSERT OR REPLACE INTO embedding_cache (text_hash, pdf_fingerprint, embedding) VALUES (?, ?, ?)",
        (text_hash, pdf_fingerprint, json.dumps(embedding))
    )
    conn.commit()


def is_doc_ingested(conn, pdf_fingerprint: str) -> tuple:
    cursor = conn.execute(
        "SELECT chunk_count FROM ingested_docs WHERE pdf_fingerprint = ?", 
        (pdf_fingerprint,)
    )
    row = cursor.fetchone()
    return (True, row[0]) if row else (False, 0)


def mark_doc_ingested(conn, pdf_fingerprint: str, doc_id: str, chunk_count: int):
    conn.execute(
        "INSERT OR REPLACE INTO ingested_docs (pdf_fingerprint, doc_id, chunk_count) VALUES (?, ?, ?)",
        (pdf_fingerprint, doc_id, chunk_count)
    )
    conn.commit()


# -------------------------
# Utilities
# -------------------------
def sha256_to_uuid(s: str) -> str:
    hash_bytes = hashlib.sha256(s.encode("utf-8")).digest()[:16]
    return str(uuid.UUID(bytes=hash_bytes))


def deterministic_chunk_id(doc_id: str, page: int, idx_start: int, idx_end: int) -> str:
    key = f"v1|{doc_id}|p{page}|{idx_start}-{idx_end}"
    return sha256_to_uuid(key)


def normalize_whitespace(s: str) -> str:
    return re.sub(r'\s+', ' ', s).strip()


def normalize_bbox(bbox: Dict[str, float]) -> Dict[str, float]:
    x0 = bbox.get("x0") or bbox.get("x") or 0
    y0 = bbox.get("y0") or bbox.get("y") or 0
    x1 = bbox.get("x1") or (x0 + bbox.get("w", 0)) or 1
    y1 = bbox.get("y1") or (y0 + bbox.get("h", 0)) or 1
    return {
        "x0": max(0, min(1, x0)),
        "y0": max(0, min(1, y0)),
        "x1": max(0, min(1, x1)),
        "y1": max(0, min(1, y1))
    }


# -------------------------
# Processing
# -------------------------
def build_spans_from_ocr_data(doc_id: str, pdf_fingerprint: str, ocr_data: Dict[str, OcrPageData]) -> List[Dict]:
    spans = []
    for page_str, page_data in ocr_data.items():
        try:
            page_num = int(page_str)
        except ValueError:
            continue
        
        for token in page_data.tokens:
            text = normalize_whitespace(token.text)
            if not text:
                continue
            spans.append({
                "docId": doc_id,
                "pdfFingerprint": pdf_fingerprint,
                "page": page_num,
                "text": text,
                "bbox": normalize_bbox(token.bbox),
                "confidence": token.confidence
            })
    
    # Sort by reading order (top to bottom, left to right)
    spans.sort(key=lambda s: (s["page"], s["bbox"]["y0"], s["bbox"]["x0"]))
    return spans


# ============ SEMANTIC-AWARE CHUNKING ============
# Configuration
TARGET_CHUNK_CHARS = 500  # Ideal chunk size (roughly 100-150 tokens)
MIN_CHUNK_CHARS = 200     # Minimum chunk size
MAX_CHUNK_CHARS = 800     # Maximum chunk size
OVERLAP_RATIO = 0.20      # 20% overlap between chunks
PARAGRAPH_GAP_THRESHOLD = 0.03  # Y-gap normalized to detect paragraph breaks


def detect_paragraph_breaks(spans: List[Dict]) -> List[int]:
    """
    Detect paragraph breaks by looking at vertical gaps between spans.
    Returns list of indices where paragraphs start.
    """
    if len(spans) < 2:
        return [0]
    
    paragraph_starts = [0]
    
    for i in range(1, len(spans)):
        prev_span = spans[i - 1]
        curr_span = spans[i]
        
        prev_y = prev_span["bbox"]["y1"]  # Bottom of previous span
        curr_y = curr_span["bbox"]["y0"]  # Top of current span
        
        # Calculate vertical gap (normalized 0-1)
        gap = curr_y - prev_y
        
        # If gap is larger than threshold, it's a paragraph break
        if gap > PARAGRAPH_GAP_THRESHOLD:
            paragraph_starts.append(i)
    
    return paragraph_starts


def group_into_paragraphs(spans: List[Dict]) -> List[List[Dict]]:
    """Group spans into paragraphs based on vertical spacing."""
    if not spans:
        return []
    
    paragraph_starts = detect_paragraph_breaks(spans)
    paragraphs = []
    
    for i, start_idx in enumerate(paragraph_starts):
        end_idx = paragraph_starts[i + 1] if i + 1 < len(paragraph_starts) else len(spans)
        para_spans = spans[start_idx:end_idx]
        if para_spans:
            paragraphs.append(para_spans)
    
    return paragraphs


def chunk_spans(spans: List[Dict], max_chars: int = MAX_CHUNK_CHARS) -> List[Dict]:
    """
    Semantic-aware chunking strategy:
    1. Detect paragraph breaks by vertical spacing
    2. Group spans by paragraphs
    3. Build chunks from paragraph groups
    4. Apply 15-25% overlap for context
    
    Each chunk includes:
    - text: concatenated text
    - bbox: bounding box covering all spans
    - spans: array of individual spans with char_start/char_end offsets
    """
    if not spans:
        return []
    
    chunks = []
    
    # Group by page first
    by_page = {}
    for s in spans:
        by_page.setdefault(s["page"], []).append(s)
    
    for page, page_spans in sorted(by_page.items()):
        # Detect paragraphs
        paragraphs = group_into_paragraphs(page_spans)
        
        # Build chunks from paragraphs
        current_chunk_spans = []
        current_char_count = 0
        
        for para_spans in paragraphs:
            para_text_len = sum(len(s["text"]) for s in para_spans)
            
            # If single paragraph is too large, split it
            if para_text_len > max_chars:
                # Flush current chunk if any
                if current_chunk_spans:
                    chunk = build_chunk_from_spans(current_chunk_spans, page, len(chunks))
                    if chunk:
                        chunks.append(chunk)
                    current_chunk_spans = []
                    current_char_count = 0
                
                # Split large paragraph into sentence-like groups
                para_chunks = split_large_paragraph(para_spans, max_chars)
                chunks.extend(para_chunks)
                continue
            
            # Check if adding this paragraph would exceed limit
            if current_char_count + para_text_len > max_chars and current_chunk_spans:
                # Build chunk with current content
                chunk = build_chunk_from_spans(current_chunk_spans, page, len(chunks))
                if chunk:
                    chunks.append(chunk)
                
                # Keep overlap: last ~20% of spans for context
                overlap_count = max(1, int(len(current_chunk_spans) * OVERLAP_RATIO))
                current_chunk_spans = current_chunk_spans[-overlap_count:]
                current_char_count = sum(len(s["text"]) for s in current_chunk_spans)
            
            # Add paragraph to current chunk
            current_chunk_spans.extend(para_spans)
            current_char_count += para_text_len
        
        # Flush remaining content
        if current_chunk_spans:
            chunk = build_chunk_from_spans(current_chunk_spans, page, len(chunks))
            if chunk:
                chunks.append(chunk)
    
    return chunks


def split_large_paragraph(spans: List[Dict], max_chars: int) -> List[Dict]:
    """Split a large paragraph into smaller chunks at natural breaks."""
    chunks = []
    current_spans = []
    current_chars = 0
    
    for span in spans:
        span_len = len(span["text"])
        
        if current_chars + span_len > max_chars and current_spans:
            # Check for sentence boundaries
            chunk = build_chunk_from_spans(current_spans, span["page"] if span else 1, len(chunks))
            if chunk:
                chunks.append(chunk)
            
            # Keep overlap
            overlap_count = max(1, int(len(current_spans) * OVERLAP_RATIO))
            current_spans = current_spans[-overlap_count:]
            current_chars = sum(len(s["text"]) for s in current_spans)
        
        current_spans.append(span)
        current_chars += span_len
    
    if current_spans:
        chunk = build_chunk_from_spans(current_spans, current_spans[0]["page"], len(chunks))
        if chunk:
            chunks.append(chunk)
    
    return chunks


def build_chunk_from_spans(spans: List[Dict], page: int, chunk_idx: int) -> Optional[Dict]:
    """Build a chunk object from a list of spans."""
    if not spans:
        return None
    
    text_buf = []
    bbox_list = []
    chunk_spans_list = []
    current_char_pos = 0
    
    for s in spans:
        span_text = s["text"]
        
        # Track character positions
        char_start = current_char_pos
        char_end = current_char_pos + len(span_text)
        
        chunk_spans_list.append({
            "text": span_text,
            "bbox": s["bbox"],
            "char_start": char_start,
            "char_end": char_end,
            "confidence": s.get("confidence")
        })
        
        text_buf.append(span_text)
        bbox_list.append(s["bbox"])
        current_char_pos = char_end + 1  # +1 for space
    
    text = " ".join(text_buf)
    
    # Skip if too short
    if len(text) < MIN_CHUNK_CHARS // 2:
        return None
    
    bbox = {
        "x0": min(b["x0"] for b in bbox_list),
        "y0": min(b["y0"] for b in bbox_list),
        "x1": max(b["x1"] for b in bbox_list),
        "y1": max(b["y1"] for b in bbox_list),
    }
    
    chunk_id = deterministic_chunk_id(
        spans[0]["docId"], 
        page, 
        chunk_idx, 
        chunk_idx + len(spans)
    )
    
    return {
        "chunk_id": chunk_id,
        "docId": spans[0]["docId"],
        "pdfFingerprint": spans[0]["pdfFingerprint"],
        "page": page,
        "text": normalize_whitespace(text),
        "bbox": bbox,
        "spans": chunk_spans_list,
        "span_count": len(spans)
    }


def embed_texts_with_cache(conn, texts: List[str], pdf_fingerprint: str) -> List[List[float]]:
    if not texts:
        return []
    
    embeddings = [None] * len(texts)
    texts_to_embed = []
    text_indices = []
    
    # Check cache
    for i, text in enumerate(texts):
        text_hash = get_text_hash(text)
        cached = get_cached_embedding(conn, text_hash)
        if cached:
            embeddings[i] = cached
        else:
            texts_to_embed.append(text)
            text_indices.append(i)
    
    print(f"[IngestAPI] Cache hit: {len(texts) - len(texts_to_embed)}/{len(texts)}")
    
    # Embed uncached texts
    if texts_to_embed:
        try:
            resp = requests.post(EMBEDDING_API, json={"texts": texts_to_embed}, timeout=120)
            resp.raise_for_status()
            new_embeddings = resp.json()["embeddings"]
            
            for idx, emb, text in zip(text_indices, new_embeddings, texts_to_embed):
                text_hash = get_text_hash(text)
                cache_embedding(conn, text_hash, pdf_fingerprint, emb)
                embeddings[idx] = emb
        except Exception as e:
            print(f"[IngestAPI] Embedding error: {e}")
            raise HTTPException(status_code=500, detail=f"Embedding service error: {e}")
    
    return embeddings


def ensure_collection_exists():
    try:
        client.get_collection(collection_name=QDRANT_COLLECTION)
    except Exception:
        print(f"[IngestAPI] Creating collection: {QDRANT_COLLECTION}")
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE)
        )


def upsert_chunks(chunks: List[Dict], embeddings: List[List[float]]):
    points = []
    for chunk, emb in zip(chunks, embeddings):
        points.append(PointStruct(
            id=chunk["chunk_id"],
            vector=emb,
            payload={
                "docId": chunk["docId"],
                "pdfFingerprint": chunk["pdfFingerprint"],
                "page": chunk["page"],
                "text": chunk["text"],
                "bbox": chunk["bbox"],
                "spans": chunk.get("spans", []),  # Include span-level info for precise highlighting
                "spanCount": chunk["span_count"]
            }
        ))
    
    # Batch upsert
    batch_size = 64
    for i in range(0, len(points), batch_size):
        batch = points[i:i + batch_size]
        client.upsert(collection_name=QDRANT_COLLECTION, points=batch)
        print(f"[IngestAPI] Upserted batch {i // batch_size + 1}: {len(batch)} points")


# -------------------------
# API Endpoints
# -------------------------
@app.get("/health")
def health():
    return {"status": "ok", "service": "ingest-api"}


@app.get("/status/{pdf_fingerprint}")
def get_status(pdf_fingerprint: str):
    conn = get_db_connection()
    ingested, count = is_doc_ingested(conn, pdf_fingerprint)
    conn.close()
    return StatusResponse(
        ingested=ingested,
        chunkCount=count,
        pdfFingerprint=pdf_fingerprint
    )


@app.post("/ingest", response_model=IngestResponse)
def ingest(req: IngestRequest):
    print("=" * 50)
    print(f"[IngestAPI] Received ingest request")
    print(f"  DocId: {req.docId}")
    print(f"  Fingerprint: {req.pdfFingerprint}")
    print(f"  Pages: {len(req.ocrData)}")
    
    conn = get_db_connection()
    
    # Check if already ingested
    ingested, existing_count = is_doc_ingested(conn, req.pdfFingerprint)
    if ingested:
        print(f"[IngestAPI] Already ingested: {existing_count} chunks")
        conn.close()
        return IngestResponse(
            success=True,
            chunksIngested=existing_count,
            message=f"Document already ingested ({existing_count} chunks)",
            cached=True
        )
    
    try:
        # Build spans from OCR data
        spans = build_spans_from_ocr_data(req.docId, req.pdfFingerprint, req.ocrData)
        print(f"[IngestAPI] Built {len(spans)} spans")
        
        if not spans:
            conn.close()
            return IngestResponse(
                success=True,
                chunksIngested=0,
                message="No text content found in OCR data"
            )
        
        # Chunk spans
        chunks = chunk_spans(spans)
        print(f"[IngestAPI] Created {len(chunks)} chunks")
        
        # Get embeddings (with caching)
        texts = [c["text"] for c in chunks]
        embeddings = embed_texts_with_cache(conn, texts, req.pdfFingerprint)
        
        # Ensure collection exists
        ensure_collection_exists()
        
        # Upsert to Qdrant
        upsert_chunks(chunks, embeddings)
        
        # Mark as ingested
        mark_doc_ingested(conn, req.pdfFingerprint, req.docId, len(chunks))
        
        print(f"[IngestAPI] ✅ Ingestion complete: {len(chunks)} chunks")
        print("=" * 50)
        
        conn.close()
        return IngestResponse(
            success=True,
            chunksIngested=len(chunks),
            message=f"Successfully ingested {len(chunks)} chunks"
        )
        
    except Exception as e:
        print(f"[IngestAPI] Error: {e}")
        import traceback
        traceback.print_exc()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9200)
