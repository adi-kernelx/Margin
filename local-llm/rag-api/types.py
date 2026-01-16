from pydantic import BaseModel, Field
from typing import List, Optional, Literal

class QueryRequest(BaseModel):
    question: str
    docIds: Optional[List[str]] = None
    topK: int = 8
    mode: Literal["precise", "summary"] = "precise"

class Source(BaseModel):
    docId: str
    page: Optional[int] = None
    bbox: Optional[List[float]] = None
    score: float
    text: str

class QueryResponse(BaseModel):
    answer: str
    confidence: float
    sources: List[Source]
    latency_ms: int
