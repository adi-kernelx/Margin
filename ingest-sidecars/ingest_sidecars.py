#!/usr/bin/env python3
"""
ingest_sidecars.py
Reads JSON sidecars (OCR + native text), builds chunks, gets embeddings from local service,
and upserts to Qdrant.

Features:
- Caches embeddings by PDF fingerprint to avoid re-generating
- Idempotent upserts (deterministic chunk IDs)
- Supports flexible sidecar formats
"""

import os
import json
import glob
import hashlib
import argparse
import sqlite3
import uuid
from typing import List, Dict, Any, Optional
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from tqdm import tqdm
import re

# CONFIG
EMBEDDING_API = "http://localhost:9000/embed"   # your local embedding service
QDRANT_URL = "http://localhost:6333"
QDRANT_COLLECTION = "pdf_chunks"
BATCH_EMBED = 64          # number of texts per embed request
MAX_CHARS_PER_CHUNK = 800
EMBEDDING_CACHE_DB = "embedding_cache.db"  # SQLite cache for embeddings

client = QdrantClient(url=QDRANT_URL)


# -------------------------
# Embedding Cache (by PDF hash)
# -------------------------
def init_embedding_cache():
    """Initialize SQLite cache for embeddings."""
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
        CREATE INDEX IF NOT EXISTS idx_pdf_fingerprint 
        ON embedding_cache(pdf_fingerprint)
    """)
    conn.commit()
    return conn


def get_cached_embedding(conn: sqlite3.Connection, text_hash: str) -> Optional[List[float]]:
    """Get embedding from cache if exists."""
    cursor = conn.execute(
        "SELECT embedding FROM embedding_cache WHERE text_hash = ?",
        (text_hash,)
    )
    row = cursor.fetchone()
    if row:
        return json.loads(row[0])
    return None


def cache_embedding(conn: sqlite3.Connection, text_hash: str, pdf_fingerprint: str, embedding: List[float]):
    """Store embedding in cache."""
    conn.execute(
        "INSERT OR REPLACE INTO embedding_cache (text_hash, pdf_fingerprint, embedding) VALUES (?, ?, ?)",
        (text_hash, pdf_fingerprint, json.dumps(embedding))
    )
    conn.commit()


def is_pdf_already_embedded(conn: sqlite3.Connection, pdf_fingerprint: str) -> bool:
    """Check if a PDF has already been embedded."""
    cursor = conn.execute(
        "SELECT COUNT(*) FROM embedding_cache WHERE pdf_fingerprint = ?",
        (pdf_fingerprint,)
    )
    count = cursor.fetchone()[0]
    return count > 0


def get_text_hash(text: str) -> str:
    """Generate hash for text content."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# -------------------------
# Utilities
# -------------------------
def sha256_to_uuid(s: str) -> str:
    """Convert SHA256 hex to UUID format (for Qdrant compatibility)."""
    hash_bytes = hashlib.sha256(s.encode("utf-8")).digest()[:16]
    return str(uuid.UUID(bytes=hash_bytes))


def deterministic_chunk_id(doc_id: str, page: int, idx_start: int, idx_end: int) -> str:
    """Generate deterministic UUID for chunk."""
    key = f"v1|{doc_id}|p{page}|{idx_start}-{idx_end}"
    return sha256_to_uuid(key)


def normalize_whitespace(s: str) -> str:
    return re.sub(r'\s+', ' ', s).strip()


def normalize_bbox(bbox: Dict[str, float], page_w: int = None, page_h: int = None):
    """Normalize bbox to 0..1 range."""
    if bbox is None:
        return {"x0": 0, "y0": 0, "x1": 1, "y1": 1}
    
    x0 = bbox.get("x0") or bbox.get("x") or 0
    y0 = bbox.get("y0") or bbox.get("y") or 0
    x1 = bbox.get("x1") or (x0 + bbox.get("w", 0)) or 1
    y1 = bbox.get("y1") or (y0 + bbox.get("h", 0)) or 1
    
    if x0 is None or x1 is None or y0 is None or y1 is None:
        return {"x0": 0, "y0": 0, "x1": 1, "y1": 1}
    
    # If numbers look large (>1) assume pixel coords and normalize
    if page_w and page_h and (x1 > 1.0 or y1 > 1.0):
        return {
            "x0": x0 / page_w, 
            "y0": y0 / page_h, 
            "x1": x1 / page_w, 
            "y1": y1 / page_h
        }
    
    # Clamp to [0,1]
    return {
        "x0": max(0, min(1, x0)), 
        "y0": max(0, min(1, y0)), 
        "x1": max(0, min(1, x1)), 
        "y1": max(0, min(1, y1))
    }


# -------------------------
# Sidecar parsing & merging
# -------------------------
def read_sidecar_file(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_spans_from_sidecar(sidecar: Dict[str, Any], source_path: str = "") -> List[Dict]:
    """
    Normalize sidecar into list of TextSpans.
    Handles multiple sidecar formats including:
    - Pages with tokens/lines
    - Flat token arrays
    - OCR page results from IndexedDB
    """
    # Try to get docId from various fields
    doc_id = (
        sidecar.get("docId") or 
        sidecar.get("documentId") or 
        sidecar.get("id") or 
        sidecar.get("pdfFingerprint") or
        os.path.splitext(os.path.basename(source_path))[0]
    )
    
    # Get PDF fingerprint for caching
    pdf_fingerprint = sidecar.get("pdfFingerprint") or sidecar.get("fingerprint") or doc_id
    
    spans = []
    
    # Check if this is an IndexedDB OCR export (has numeric page keys)
    is_ocr_cache = all(k.isdigit() or k in ['localFileId', 'pdfFingerprint', 'displayName', 'ocrData'] for k in sidecar.keys() if not k.startswith('_'))
    
    if 'ocrData' in sidecar:
        # This is a LocalFile record from IndexedDB
        ocr_data = sidecar.get('ocrData', {})
        doc_id = sidecar.get('localFileId') or sidecar.get('pdfFingerprint') or doc_id
        pdf_fingerprint = sidecar.get('pdfFingerprint') or doc_id
        
        for page_str, page_data in ocr_data.items():
            if not page_str.isdigit():
                continue
            page_num = int(page_str)
            tokens = page_data.get('tokens', [])
            for t in tokens:
                text = normalize_whitespace(t.get("text", ""))
                if not text:
                    continue
                bbox = t.get("bbox", {})
                spans.append({
                    "docId": doc_id,
                    "pdfFingerprint": pdf_fingerprint,
                    "page": page_num,
                    "text": text,
                    "bbox": normalize_bbox(bbox),
                    "source": "ocr",
                    "confidence": t.get("confidence", None)
                })
    
    elif is_ocr_cache:
        # Direct OCR cache format (page numbers as keys)
        for key, value in sidecar.items():
            if key.isdigit():
                page_num = int(key)
                tokens = value.get('tokens', []) if isinstance(value, dict) else []
                for t in tokens:
                    text = normalize_whitespace(t.get("text", ""))
                    if not text:
                        continue
                    bbox = t.get("bbox", {})
                    spans.append({
                        "docId": doc_id,
                        "pdfFingerprint": pdf_fingerprint,
                        "page": page_num,
                        "text": text,
                        "bbox": normalize_bbox(bbox),
                        "source": "ocr",
                        "confidence": t.get("confidence", None)
                    })
    
    else:
        # Try other common formats
        pages = sidecar.get("pages") or sidecar.get("pageResults") or []
        
        if not pages and "tokens" in sidecar:
            # Flat token format
            tokens = sidecar.get("tokens", [])
            page_num = int(sidecar.get("page", 1))
            for t in tokens:
                text = normalize_whitespace(t.get("text", ""))
                if not text:
                    continue
                bbox = t.get("bbox", {})
                spans.append({
                    "docId": doc_id,
                    "pdfFingerprint": pdf_fingerprint,
                    "page": page_num,
                    "text": text,
                    "bbox": normalize_bbox(bbox),
                    "source": "ocr",
                    "confidence": t.get("confidence", None)
                })
        
        for p in pages:
            page_num = int(p.get("page") or p.get("pageIndex", 1))
            page_w = p.get("width") or p.get("pageWidth")
            page_h = p.get("height") or p.get("pageHeight")
            
            # Native text spans
            native_spans = p.get("native_spans") or p.get("native") or p.get("textLayer") or []
            for n in native_spans:
                text = normalize_whitespace(n.get("text") or n.get("str") or "")
                if not text:
                    continue
                bbox = n.get("bbox") or n.get("rect") or {}
                spans.append({
                    "docId": doc_id,
                    "pdfFingerprint": pdf_fingerprint,
                    "page": page_num,
                    "text": text,
                    "bbox": normalize_bbox(bbox, page_w, page_h),
                    "source": "native",
                    "confidence": n.get("confidence", None)
                })
            
            # OCR spans
            ocr_spans = p.get("ocr_spans") or p.get("ocr") or p.get("tokens") or []
            for o in ocr_spans:
                text = normalize_whitespace(o.get("text") or o.get("str") or "")
                if not text:
                    continue
                bbox = o.get("bbox") or o.get("box") or {}
                spans.append({
                    "docId": doc_id,
                    "pdfFingerprint": pdf_fingerprint,
                    "page": page_num,
                    "text": text,
                    "bbox": normalize_bbox(bbox, page_w, page_h),
                    "source": "ocr",
                    "confidence": o.get("confidence", None)
                })
    
    return [s for s in spans if s.get("text")]


# -------------------------
# Merge & chunk logic
# -------------------------
def iou(a, b):
    xA = max(a["x0"], b["x0"])
    yA = max(a["y0"], b["y0"])
    xB = min(a["x1"], b["x1"])
    yB = min(a["y1"], b["y1"])
    inter_w = max(0, xB - xA)
    inter_h = max(0, yB - yA)
    inter = inter_w * inter_h
    areaA = max(1e-9, (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]))
    areaB = max(1e-9, (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]))
    return inter / (areaA + areaB - inter + 1e-9)


def merge_spans(native_spans: List[Dict], ocr_spans: List[Dict]) -> List[Dict]:
    """Merge native and OCR spans, avoiding duplicates."""
    merged = list(native_spans)
    for o in ocr_spans:
        overlap = False
        for n in native_spans:
            if iou(o["bbox"], n["bbox"]) > 0.6:
                if o["text"].strip().lower() == n["text"].strip().lower():
                    overlap = True
                    break
        if not overlap:
            merged.append(o)
    merged.sort(key=lambda s: (s["bbox"]["y0"], s["bbox"]["x0"]))
    return merged


def chunk_spans(spans: List[Dict], max_chars: int = MAX_CHARS_PER_CHUNK) -> List[Dict]:
    """Create chunks from spans."""
    chunks = []
    i = 0
    while i < len(spans):
        j = i
        text_buf = []
        bbox_list = []
        char_count = 0
        while j < len(spans) and (char_count < max_chars or len(text_buf) == 0):
            s = spans[j]
            text_buf.append(s["text"])
            bbox_list.append(s["bbox"])
            char_count += len(s["text"])
            j += 1
        
        text = " ".join(text_buf)
        bbox = {
            "x0": min(b["x0"] for b in bbox_list),
            "y0": min(b["y0"] for b in bbox_list),
            "x1": max(b["x1"] for b in bbox_list),
            "y1": max(b["y1"] for b in bbox_list),
        }
        chunk_id = deterministic_chunk_id(spans[i]["docId"], spans[i]["page"], i, j - 1)
        chunks.append({
            "chunk_id": chunk_id,
            "docId": spans[i]["docId"],
            "pdfFingerprint": spans[i].get("pdfFingerprint", spans[i]["docId"]),
            "page": spans[i]["page"],
            "text": normalize_whitespace(text),
            "bbox": bbox,
            "span_count": j - i,
            "idx_start": i,
            "idx_end": j - 1
        })
        i = j
    return chunks


# -------------------------
# Embedding & Qdrant upsert
# -------------------------
def embed_batch_with_cache(conn: sqlite3.Connection, texts: List[str], pdf_fingerprint: str) -> List[List[float]]:
    """Get embeddings, using cache when possible."""
    if not texts:
        return []
    
    embeddings = [None] * len(texts)
    texts_to_embed = []
    text_indices = []
    
    # Check cache first
    for i, text in enumerate(texts):
        text_hash = get_text_hash(text)
        cached = get_cached_embedding(conn, text_hash)
        if cached:
            embeddings[i] = cached
        else:
            texts_to_embed.append(text)
            text_indices.append(i)
    
    # Get embeddings for uncached texts
    if texts_to_embed:
        print(f"  Embedding {len(texts_to_embed)} new texts (cached: {len(texts) - len(texts_to_embed)})")
        resp = requests.post(EMBEDDING_API, json={"texts": texts_to_embed}, timeout=120)
        resp.raise_for_status()
        new_embeddings = resp.json()["embeddings"]
        
        # Store in cache and result
        for idx, emb, text in zip(text_indices, new_embeddings, texts_to_embed):
            text_hash = get_text_hash(text)
            cache_embedding(conn, text_hash, pdf_fingerprint, emb)
            embeddings[idx] = emb
    
    return embeddings


def upsert_chunks_to_qdrant(chunks: List[Dict], cache_conn: sqlite3.Connection, batch_size: int = 64):
    """Upsert chunks to Qdrant with embedding caching."""
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        texts = [c["text"] for c in batch]
        pdf_fingerprint = batch[0].get("pdfFingerprint", batch[0]["docId"])
        
        embeddings = embed_batch_with_cache(cache_conn, texts, pdf_fingerprint)
        
        points = []
        for c, emb in zip(batch, embeddings):
            p = PointStruct(
                id=c["chunk_id"],
                vector=emb,
                payload={
                    "docId": c["docId"],
                    "pdfFingerprint": c.get("pdfFingerprint", c["docId"]),
                    "page": c["page"],
                    "text": c["text"],
                    "bbox": c["bbox"],
                    "spanCount": c["span_count"]
                }
            )
            points.append(p)
        
        client.upsert(collection_name=QDRANT_COLLECTION, points=points)
        print(f"Upserted batch {i // batch_size + 1}: {len(points)} points")


# -------------------------
# Top-level
# -------------------------
def ingest_sidecars_folder(folder: str, max_chars: int = MAX_CHARS_PER_CHUNK, batch_size: int = BATCH_EMBED, force: bool = False):
    """Ingest all sidecar JSON files from a folder."""
    files = sorted(glob.glob(os.path.join(folder, "*.json")))
    if not files:
        print("No sidecar JSON files found in", folder)
        return
    
    # Initialize embedding cache
    cache_conn = init_embedding_cache()
    
    all_chunks = []
    skipped_pdfs = []
    
    for f in tqdm(files, desc="Reading sidecars"):
        try:
            sc = read_sidecar_file(f)
        except Exception as e:
            print("Failed to read", f, e)
            continue
        
        # Get PDF fingerprint
        pdf_fingerprint = sc.get("pdfFingerprint") or sc.get("fingerprint") or os.path.basename(f)
        
        # Check if already embedded (skip if not forcing)
        if not force and is_pdf_already_embedded(cache_conn, pdf_fingerprint):
            skipped_pdfs.append(pdf_fingerprint)
            continue
        
        spans = build_spans_from_sidecar(sc, source_path=f)
        
        # Split spans per page
        by_page = {}
        for s in spans:
            by_page.setdefault(s["page"], []).append(s)
        
        for page, sp_list in by_page.items():
            natives = [s for s in sp_list if s["source"] == "native"]
            ocrs = [s for s in sp_list if s["source"] == "ocr"]
            merged = merge_spans(natives, ocrs)
            chunks = chunk_spans(merged, max_chars=max_chars)
            all_chunks.extend(chunks)
    
    if skipped_pdfs:
        print(f"Skipped {len(skipped_pdfs)} already-embedded PDFs. Use --force to re-embed.")
    
    if not all_chunks:
        print("No new chunks to process.")
        return
    
    print(f"Processing {len(all_chunks)} chunks...")
    
    # Ensure Qdrant collection exists
    try:
        client.get_collection(collection_name=QDRANT_COLLECTION)
    except Exception:
        print("Creating collection", QDRANT_COLLECTION)
        from qdrant_client.models import VectorParams, Distance
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE)
        )
    
    # Upsert with caching
    upsert_chunks_to_qdrant(all_chunks, cache_conn, batch_size=batch_size)
    
    cache_conn.close()
    print(f"Ingestion complete. Total chunks: {len(all_chunks)}")


# -------------------------
# CLI
# -------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest OCR sidecars into Qdrant")
    parser.add_argument("--folder", "-f", default="./sidecars", help="Folder containing sidecar JSON files")
    parser.add_argument("--batch", "-b", type=int, default=BATCH_EMBED, help="Embed batch size")
    parser.add_argument("--max-chars", "-m", type=int, default=MAX_CHARS_PER_CHUNK, help="Max chars per chunk")
    parser.add_argument("--force", action="store_true", help="Force re-embedding even if already cached")
    args = parser.parse_args()
    
    ingest_sidecars_folder(args.folder, max_chars=args.max_chars, batch_size=args.batch, force=args.force)
