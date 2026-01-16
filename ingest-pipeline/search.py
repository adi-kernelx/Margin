"""
search.py - Enhanced semantic search with:
1. Hybrid scoring (vector + keyword + overlap)
2. Minimum similarity threshold
3. Multi-span highlighting
4. Deduplication of similar results
5. Query normalization
"""

import requests
import re
from typing import Optional
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

QDRANT_URL = "http://localhost:6333"
COLLECTION = "pdf_chunks"
EMBEDDING_API = "http://localhost:9000/embed"

# ============ CONFIGURATION ============
MIN_SIMILARITY_THRESHOLD = 0.25  # Minimum vector similarity to include result (lowered for better recall)
VECTOR_WEIGHT = 0.55             # Weight for vector similarity
KEYWORD_WEIGHT = 0.30            # Weight for keyword match (increased - exact matches matter!)
OVERLAP_WEIGHT = 0.15            # Weight for token overlap

client = QdrantClient(url=QDRANT_URL)


# ============ QUERY NORMALIZATION ============
def normalize_query(query: str) -> str:
    """
    Lightweight query rewriting to improve embedding quality.
    Removes filler words and normalizes common patterns.
    """
    q = query.lower().strip()
    
    # Remove question patterns
    patterns_to_remove = [
        r'^what is\s+',
        r'^what are\s+',
        r'^explain\s+',
        r'^how does\s+',
        r'^how do\s+',
        r'^define\s+',
        r'^describe\s+',
        r'^tell me about\s+',
        r'^show me\s+',
        r'^find\s+',
    ]
    
    for pattern in patterns_to_remove:
        q = re.sub(pattern, '', q)
    
    # Remove trailing question marks
    q = q.rstrip('?')
    
    return q.strip() or query.strip()


# ============ TOKENIZATION ============
def simple_tokenize(text: str) -> set:
    """Simple tokenizer for keyword matching."""
    # Extract words, minimum 2 chars
    return set(w for w in re.findall(r'\w+', text.lower()) if len(w) >= 2)


# ============ HYBRID SCORING ============
def compute_hybrid_score(
    vector_score: float,
    query: str,
    chunk_text: str
) -> tuple[float, dict]:
    """
    Compute hybrid score combining:
    - Vector similarity (semantic)
    - Keyword match (exact phrase)
    - Token overlap (word-level)
    
    Returns (final_score, score_breakdown)
    """
    query_lower = query.lower().strip()
    text_lower = chunk_text.lower()
    
    # 1. Vector component
    vector_component = vector_score * VECTOR_WEIGHT
    
    # 2. Keyword match boost (exact phrase found)
    keyword_bonus = 0.0
    if query_lower in text_lower:
        keyword_bonus = 0.15  # Full bonus for exact match
    elif any(word in text_lower for word in query_lower.split() if len(word) > 3):
        keyword_bonus = 0.08  # Partial bonus for word match
    keyword_component = keyword_bonus * KEYWORD_WEIGHT
    
    # 3. Token overlap score
    query_tokens = simple_tokenize(query_lower)
    chunk_tokens = simple_tokenize(text_lower)
    
    if query_tokens:
        overlap = query_tokens & chunk_tokens
        overlap_ratio = len(overlap) / len(query_tokens)
        overlap_bonus = min(0.2, overlap_ratio * 0.15)
    else:
        overlap_bonus = 0.0
    overlap_component = overlap_bonus * OVERLAP_WEIGHT
    
    final_score = (vector_component + keyword_component + overlap_component) / (VECTOR_WEIGHT + KEYWORD_WEIGHT + OVERLAP_WEIGHT)
    # Normalize to 0-1 range
    final_score = min(1.0, final_score)
    
    breakdown = {
        "vector": vector_score,
        "keyword": keyword_bonus,
        "overlap": overlap_bonus,
        "final": final_score
    }
    
    return final_score, breakdown


# ============ SPAN MATCHING ============
def find_best_matching_spans(query: str, chunk_text: str, spans: list) -> list:
    """
    Find spans that best match the query.
    Returns up to 3 matching span bboxes for precise highlighting.
    Also includes adjacent spans for context.
    """
    if not spans:
        return []
    
    query_lower = query.lower().strip()
    text_lower = chunk_text.lower()
    query_tokens = simple_tokenize(query_lower)
    
    # Score each span
    scored_spans = []
    for i, span in enumerate(spans):
        span_text = span.get("text", "").lower()
        span_tokens = simple_tokenize(span_text)
        
        score = 0.0
        
        # Exact substring match
        if query_lower in span_text:
            score += 1.0
        
        # Token overlap
        if query_tokens and span_tokens:
            overlap = query_tokens & span_tokens
            score += len(overlap) / max(len(query_tokens), 1) * 0.5
        
        scored_spans.append((i, span, score))
    
    # Sort by score descending
    scored_spans.sort(key=lambda x: x[2], reverse=True)
    
    # Get best matching spans
    best_indices = set()
    result_spans = []
    
    for i, span, score in scored_spans[:2]:  # Top 2 matches
        if score > 0:
            best_indices.add(i)
            result_spans.append(span)
            
            # Add adjacent spans for context (multi-span highlighting)
            if i > 0 and (i - 1) not in best_indices:
                best_indices.add(i - 1)
                result_spans.append(spans[i - 1])
            if i < len(spans) - 1 and (i + 1) not in best_indices:
                best_indices.add(i + 1)
                result_spans.append(spans[i + 1])
    
    # Limit to 3 spans max
    if len(result_spans) > 3:
        result_spans = result_spans[:3]
    
    # Fallback: return first 2 spans if no matches
    if not result_spans:
        result_spans = spans[:2]
    
    return result_spans


# ============ DEDUPLICATION ============
def deduplicate_results(results: list) -> list:
    """
    Remove duplicate/near-duplicate results.
    Groups by (docId, page, vertical region).
    """
    seen = set()
    filtered = []
    
    for r in results:
        doc_id = r.get("docId", "")
        page = r.get("page", 0)
        bbox = r.get("bbox", {})
        
        # Bucket by vertical position (5% of page height)
        y_bucket = int(bbox.get("y0", 0) * 20)  # 20 buckets per page
        
        key = (doc_id, page, y_bucket)
        
        if key not in seen:
            seen.add(key)
            filtered.append(r)
    
    return filtered


# ============ MAIN SEARCH ============
def semantic_search(
    query: str,
    limit: int = 10,  # Fetch more initially for filtering
    doc_id: Optional[str] = None,
    pdf_fingerprint: Optional[str] = None
) -> list:
    """
    Enhanced semantic search with hybrid scoring.
    """
    # Normalize query for better embedding
    normalized_query = normalize_query(query)
    print(f"[Search] Query: '{query}' → Normalized: '{normalized_query}'")
    
    # Get embedding
    vector = embed_query(normalized_query)
    
    # Build filter
    search_filter = None
    if pdf_fingerprint:
        search_filter = Filter(
            must=[
                FieldCondition(key="pdfFingerprint", match=MatchValue(value=pdf_fingerprint))
            ]
        )
    elif doc_id:
        search_filter = Filter(
            must=[
                FieldCondition(key="docId", match=MatchValue(value=doc_id))
            ]
        )
    
    # Fetch more results than needed (for post-filtering)
    fetch_limit = limit * 3
    
    results = client.query_points(
        collection_name=COLLECTION,
        query=vector,
        limit=fetch_limit,
        with_payload=True,
        query_filter=search_filter
    )
    
    # Process and score results
    scored_results = []
    
    for hit in results.points:
        payload = hit.payload
        chunk_text = payload.get("text", "")
        
        # Apply minimum threshold on vector score
        if hit.score < MIN_SIMILARITY_THRESHOLD:
            continue
        
        # Compute hybrid score
        final_score, breakdown = compute_hybrid_score(hit.score, query, chunk_text)
        
        # Get matching spans
        stored_spans = payload.get("spans", [])
        matching_spans = find_best_matching_spans(query, chunk_text, stored_spans)
        
        # Clean up spans for output
        output_spans = []
        for s in matching_spans:
            output_spans.append({
                "text": s.get("text", ""),
                "bbox": s.get("bbox", {}),
                "char_start": s.get("char_start"),
                "char_end": s.get("char_end")
            })
        
        scored_results.append({
            "score": final_score,
            "vector_score": hit.score,
            "docId": payload.get("docId"),
            "pdfFingerprint": payload.get("pdfFingerprint"),
            "page": payload.get("page"),
            "text": chunk_text,
            "bbox": payload.get("bbox"),
            "spans": output_spans if output_spans else None
        })
    
    # Sort by hybrid score
    scored_results.sort(key=lambda x: x["score"], reverse=True)
    
    # Deduplicate
    deduped = deduplicate_results(scored_results)
    
    # Return top N
    final_results = deduped[:limit]
    
    print(f"[Search] Found {len(results.points)} raw → {len(scored_results)} filtered → {len(deduped)} deduped → {len(final_results)} returned")
    
    return final_results


def embed_query(text: str) -> list:
    """Get embedding vector for query text."""
    resp = requests.post(
        EMBEDDING_API,
        json={"texts": [text]},
        timeout=30
    )
    resp.raise_for_status()
    return resp.json()["embeddings"][0]


if __name__ == "__main__":
    query = input("Search query: ")
    results = semantic_search(query)
    
    print(f"\n{'='*50}")
    print(f"Found {len(results)} results")
    print(f"{'='*50}")
    
    for i, r in enumerate(results, 1):
        print(f"\n--- Result {i} ---")
        print(f"Score: {r['score']:.3f} (vector: {r['vector_score']:.3f})")
        print(f"Doc: {r['docId'][:20]}... | Page: {r['page']}")
        print(f"Spans: {len(r.get('spans') or [])} matching")
        text = r.get("text", "")
        print(text[:120] + "..." if len(text) > 120 else text)
