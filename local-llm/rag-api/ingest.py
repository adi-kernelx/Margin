from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import hashlib
import uuid
import re
from qdrant_client.models import FieldCondition, Filter, MatchValue, PointStruct
import store

# CONFIG
MAX_CHUNK_CHARS = 800
MIN_CHUNK_CHARS = 200
OVERLAP_RATIO = 0.20
QDRANT_COLLECTION = store.PASSAGES

# --- Models ---
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

# --- Logic ---

def normalize_whitespace(s: str) -> str:
    return re.sub(r'\s+', ' ', s).strip()

def normalize_bbox(bbox: Dict[str, float]) -> Dict[str, float]:
    x0 = bbox.get("x0", 0)
    y0 = bbox.get("y0", 0)
    x1 = bbox.get("x1") or (x0 + bbox.get("w", 0)) or 1
    y1 = bbox.get("y1") or (y0 + bbox.get("h", 0)) or 1
    return {
        "x0": max(0, min(1, x0)),
        "y0": max(0, min(1, y0)),
        "x1": max(0, min(1, x1)),
        "y1": max(0, min(1, y1))
    }

def sha256_to_uuid(s: str) -> str:
    hash_bytes = hashlib.sha256(s.encode("utf-8")).digest()[:16]
    return str(uuid.UUID(bytes=hash_bytes))

def deterministic_chunk_id(doc_id: str, page: int, idx_start: int, idx_end: int) -> str:
    key = f"v1|{doc_id}|p{page}|{idx_start}-{idx_end}"
    return sha256_to_uuid(key)

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
    # y0 is primary sort, x0 is secondary
    spans.sort(key=lambda s: (s["page"], s["bbox"]["y0"], s["bbox"]["x0"]))
    return spans

def detect_paragraph_breaks(spans: List[Dict]) -> List[int]:
    if len(spans) < 2:
        return [0]
    paragraph_starts = [0]
    PARAGRAPH_GAP_THRESHOLD = 0.03
    for i in range(1, len(spans)):
        prev_y = spans[i - 1]["bbox"]["y1"]
        curr_y = spans[i]["bbox"]["y0"]
        if (curr_y - prev_y) > PARAGRAPH_GAP_THRESHOLD:
            paragraph_starts.append(i)
    return paragraph_starts

def group_into_paragraphs(spans: List[Dict]) -> List[List[Dict]]:
    if not spans: return []
    starts = detect_paragraph_breaks(spans)
    lists = []
    for i, start in enumerate(starts):
        end = starts[i+1] if i+1 < len(starts) else len(spans)
        lists.append(spans[start:end])
    return lists

def build_chunk_from_spans(spans: List[Dict], page: int, chunk_idx: int) -> Optional[Dict]:
    if not spans: return None
    text_buf = []
    bbox_list = []
    chunk_spans_list = []
    current_char_pos = 0
    
    for s in spans:
        span_text = s["text"]
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
        current_char_pos = char_end + 1
    
    text = " ".join(text_buf)
    if len(text) < MIN_CHUNK_CHARS // 2:
        return None
        
    chunk_id = deterministic_chunk_id(spans[0]["docId"], page, chunk_idx, chunk_idx + len(spans))
    
    return {
        "chunk_id": chunk_id,
        "docId": spans[0]["docId"],
        "pdfFingerprint": spans[0]["pdfFingerprint"],
        "page": page,
        "text": text,
        "bbox": [
            min(b["x0"] for b in bbox_list),
            min(b["y0"] for b in bbox_list),
            max(b["x1"] for b in bbox_list),
            max(b["y1"] for b in bbox_list)
        ],
        "spans": chunk_spans_list,
        "span_count": len(spans)
    }

def chunk_spans(spans: List[Dict]) -> List[Dict]:
    if not spans: return []
    chunks = []
    by_page = {}
    for s in spans: by_page.setdefault(s["page"], []).append(s)
    
    for page, page_spans in sorted(by_page.items()):
        paragraphs = group_into_paragraphs(page_spans)
        current_chunk_spans = []
        current_char_count = 0
        
        for para_spans in paragraphs:
            para_len = sum(len(s["text"]) for s in para_spans)
            
            # Simple chunking logic for now
            if current_char_count + para_len > MAX_CHUNK_CHARS and current_chunk_spans:
                c = build_chunk_from_spans(current_chunk_spans, page, len(chunks))
                if c: chunks.append(c)
                
                overlap = max(1, int(len(current_chunk_spans) * OVERLAP_RATIO))
                current_chunk_spans = current_chunk_spans[-overlap:]
                current_char_count = sum(len(s["text"]) for s in current_chunk_spans)
            
            current_chunk_spans.extend(para_spans)
            current_char_count += para_len
            
        if current_chunk_spans:
            c = build_chunk_from_spans(current_chunk_spans, page, len(chunks))
            if c: chunks.append(c)
            
    return chunks

def ensure_collection():
    store.ensure_collection(QDRANT_COLLECTION)

def process_ingest(req: IngestRequest) -> IngestResponse:
    from embedder import get_embeddings
    print(f"[Ingest] Processing doc: {req.docId}, pages: {len(req.ocrData)}")
    ensure_collection()
    
    # Check existing? (Skipping for now to simplify logic, assume overwrite or multiple versions)
    
    spans = build_spans_from_ocr_data(req.docId, req.pdfFingerprint, req.ocrData)
    if not spans:
        return IngestResponse(success=True, chunksIngested=0, message="No text found")
        
    chunks = chunk_spans(spans)
    if not chunks:
        return IngestResponse(success=True, chunksIngested=0, message="No chunks created")
        
    texts = [c["text"] for c in chunks]
    embeddings = get_embeddings(texts)
    
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
                "spans": chunk.get("spans", []),
                "spanCount": chunk["span_count"]
            }
        ))
        
    # Upsert
    store.get_qdrant().upsert(collection_name=QDRANT_COLLECTION, points=points)
    store.changed()
    print(f"[Ingest] Upserted {len(points)} chunks.")
    
    return IngestResponse(
        success=True,
        chunksIngested=len(chunks), 
        message=f"Ingested {len(chunks)} chunks"
    )

def check_status(pdf_fingerprint: str) -> StatusResponse:
    qdrant = store.get_qdrant()
    try:
        # Check if we have chunks for this fingerprint
        res = qdrant.count(
            collection_name=QDRANT_COLLECTION,
            count_filter=Filter(
                must=[FieldCondition(key="pdfFingerprint", match=MatchValue(value=pdf_fingerprint))]
            )
        )
        return StatusResponse(
            ingested=res.count > 0,
            chunkCount=res.count,
            pdfFingerprint=pdf_fingerprint
        )
    except Exception as e:
        # If collection doesn't exist or other error
        print(f"[Ingest] Status check error: {e}")
        return StatusResponse(
            ingested=False,
            chunkCount=0,
            pdfFingerprint=pdf_fingerprint
        )
