"""Serve only POST /bundle (and /health), without the chat pipeline.

The full service (main.py) also runs without Docker now (embedded Qdrant, a
local Ollama model) and includes /bundle. This entry point is for when only
the Knowledge panel is needed: it loads no embedding, reranker or LLM client.

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
