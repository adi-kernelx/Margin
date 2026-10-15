from pydantic import BaseModel
from typing import List, Optional

from typing import Literal, Dict, Any

class QueryScope(BaseModel):
    docIds: Optional[List[str]] = None
    pages: Optional[List[int]] = None
    selection: Optional[str] = None

class QueryRequest(BaseModel):
    question: str
    mode: Literal["qa", "summary", "compare", "explain", "extract"] = "qa"
    scope: Optional[QueryScope] = None
    topK: int = 8
    sessionId: Optional[str] = None

class Source(BaseModel):
    docId: str
    page: Optional[int] = None
    # Passages: [x0, y0, x1, y1]; concepts: {x0, y0, x1, y1}. Both normalised to the page.
    bbox: Optional[Any] = None
    score: float
    text: Optional[str] = None
    relevance_score: Optional[float] = None  # Added for cross-encoder score
    kind: Literal["passage", "concept"] = "passage"
    pdfFingerprint: Optional[str] = None
    # Concepts only: what the reader sees on the citation and where it lives in the bundle.
    title: Optional[str] = None
    type: Optional[str] = None
    conceptPath: Optional[str] = None
    verified: bool = False

class QueryResponse(BaseModel):
    answer: str
    confidence: float
    sources: List[Source]
    metrics: Optional[dict] = None # For grounding/validation metrics
