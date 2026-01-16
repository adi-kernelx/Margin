from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from search import semantic_search  # reuse your logic

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SearchRequest(BaseModel):
    query: str
    docId: Optional[str] = None
    pdfFingerprint: Optional[str] = None
    limit: int = 5

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/search")
def search(req: SearchRequest):
    print("=" * 50)
    print(f"[SearchAPI] Received request:")
    print(f"  Query: {req.query}")
    print(f"  DocId: {req.docId}")
    print(f"  pdfFingerprint: {req.pdfFingerprint}")
    print(f"  Limit: {req.limit}")
    
    try:
        results = semantic_search(
            query=req.query,
            limit=req.limit,
            doc_id=req.docId,
            pdf_fingerprint=req.pdfFingerprint
        )
        print(f"[SearchAPI] Found {len(results)} results")
        for i, r in enumerate(results[:3]):  # Show first 3
            text = r.get('text', '')[:50] if r.get('text') else ''
            print(f"  [{i+1}] Score: {r['score']:.4f}, Page: {r.get('page')}, Text: {text}...")
        print("=" * 50)
        return {"results": results}
    except Exception as e:
        print(f"[SearchAPI] ERROR: {e}")
        import traceback
        traceback.print_exc()
        print("=" * 50)
        return {"results": [], "error": "Search failed. Please try again."}


