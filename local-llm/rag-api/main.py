from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from schemas import QueryRequest, QueryResponse
from graph import run_graph
from ingest import process_ingest, check_status, IngestRequest, IngestResponse, StatusResponse

app = FastAPI(title="Local RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

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
