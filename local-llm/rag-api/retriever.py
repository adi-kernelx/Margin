from qdrant_client import QdrantClient
from qdrant_client.http import models
from embedder import get_embedding
import os

QDRANT_URL = os.getenv("QDRANT_URL", "http://host.docker.internal:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")

qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

from schemas import QueryScope

def retrieve(question: str, top_k: int = 8, scope: QueryScope = None):
    print(f"[Retriever] Query: {question}, Scope: {scope}")
    query_vector = get_embedding(question)
    
    must_filters = []
    
    if scope:
        if scope.docIds:
            must_filters.append(
                models.FieldCondition(
                    key="docId",
                    match=models.MatchAny(any=scope.docIds)
                )
            )
        if scope.pages:
            must_filters.append(
                models.FieldCondition(
                    key="pageNumber",
                    match=models.MatchAny(any=scope.pages)
                )
            )
            
    filters = None
    if must_filters:
        filters = models.Filter(must=must_filters)
        
    try:
        result = qdrant.query_points(
            collection_name="pdf_chunks",
            query=query_vector,
            query_filter=filters,
            limit=top_k
        )
        hits = result.points
        
        return [
            {
                "text": p.payload.get("text", ""),
                "docId": p.payload.get("docId"),
                "page": p.payload.get("pageNumber"),
                "bbox": p.payload.get("bbox"),
                "score": p.score
            }
            for p in hits
        ]
    except Exception as e:
        print(f"[Retriever] Error: {e}")
        return []
