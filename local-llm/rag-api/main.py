from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from schemas import QueryRequest, QueryResponse
from graph import run_graph
from ingest import process_ingest, check_status, build_spans_from_pdf, ingest_spans, IngestRequest, IngestResponse, StatusResponse
from embedder import get_embedding
from okf_api import router as okf_router
from llm_client import status as llm_status
from concepts_api import router as concepts_router

app = FastAPI(title="Local RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(okf_router)
app.include_router(concepts_router)

class EmbedRequest(BaseModel):
    text: str

class EmbedResponse(BaseModel):
    embedding: List[float]

@app.get("/health")
def health():
    # "llm" is online, offline (server not reachable) or missing (model not pulled)
    return {"status": "ok", **llm_status()}

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


@app.post("/ingest/pdf", response_model=IngestResponse)
def ingest_pdf_endpoint(file: UploadFile = File(...), docId: str = Form(...), pdfFingerprint: str = Form(...)):
    """Index a PDF's own text layer, so text PDFs need no OCR before the assistant can use them."""
    data = file.file.read()
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Not a PDF")
    return ingest_spans(build_spans_from_pdf(docId, pdfFingerprint, data))

@app.get("/status/{fingerprint}", response_model=StatusResponse)
def status_endpoint(fingerprint: str):
    return check_status(fingerprint)
