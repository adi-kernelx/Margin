from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from schemas import QueryRequest, QueryResponse
from graph import run_graph
from ingest import process_ingest, check_status, IngestRequest, IngestResponse, StatusResponse
from embedder import get_embedding
from okf_api import router as okf_router

app = FastAPI(title="Local RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(okf_router)

class EmbedRequest(BaseModel):
    text: str

class EmbedResponse(BaseModel):
    embedding: List[float]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/embed", response_model=EmbedResponse)
def embed_endpoint(req: EmbedRequest):
    """Generate embedding for a single text query."""
    embedding = get_embedding(req.text)
    return EmbedResponse(embedding=embedding)

@app.post("/query", response_model=QueryResponse)
async def query_endpoint(req: QueryRequest):
    try:
        return await run_graph(req)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise e


@app.post("/ingest", response_model=IngestResponse)
def ingest_endpoint(req: IngestRequest):
    return process_ingest(req)

@app.get("/status/{fingerprint}", response_model=StatusResponse)
def status_endpoint(fingerprint: str):
    return check_status(fingerprint)
