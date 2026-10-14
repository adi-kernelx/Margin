"""Serve only POST /bundle (and /health), without the chat pipeline or Docker.

The full service (main.py) also loads LangGraph, Qdrant and the LLM client.
This entry point needs only FastAPI and the ml/ environment, so the Knowledge
panel can be used on a machine without the RAG stack:

    .venv-ml\\Scripts\\python.exe -m uvicorn bundle_server:app --app-dir local-llm/rag-api --port 9101

Do not run it at the same time as main.py; both use port 9101.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from okf_api import router

app = FastAPI(title="Margin bundle service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
