# RAG Architecture & Runtime Contract

This document locks down the architecture for the Local RAG system as implemented in `rag-service/`.

## 1. Model Decision
- **Model**: `DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf`
- **Source**: `bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF`
- **Placement**: `rag-service/models/`
- **Loader**: `llama.cpp` server (Docker: `ghcr.io/ggerganov/llama.cpp:server`)

## 2. Runtime Strategy
- **Container 1 (Inference)**: `llm-runtime`
  - Image: `ghcr.io/ggerganov/llama.cpp:server`
  - Port: `8081`
  - Responsbility: Pure inference API (OpenAI compatible).
- **Container 2 (Orchestration)**: `rag-api`
  - Stack: FastAPI + LangGraph + QdrantClient + SentenceTransformers
  - Port: `9101`
  - Responsibility: Embedding, Retrieval, Prompt Assembly, Response Formating.

## 3. Directory Structure
```
rag-service/
├── docker-compose.yml    # Orchestrates both containers
├── requirements.txt      # Python deps for rag-api
├── Dockerfile            # rag-api build
├── models/               # Mounted volume for GGUF
├── src/
│   ├── main.py           # FastAPI entry point
│   ├── graph.py          # LangGraph workflow (Retrieve -> Generate)
│   └── types.py          # Pydantic models (API Contract)
└── scripts/
    └── download_model.py # Helper to fetch GGUF
```

## 4. API Contract (Frozen)
**POST /query**
```json
{
  "question": "What is the refund policy?",
  "docIds": ["doc-123"],
  "topK": 8,
  "mode": "precise"
}
```

**Response**
```json
{
  "answer": "The refund policy allows...",
  "confidence": 0.81,
  "sources": [
    {
      "docId": "doc-123",
      "page": 4,
      "text": "...",
      "score": 0.87
    }
  ],
  "latency_ms": 1430
}
```

## 5. Integration Points
- **Retrieval**: Connects to Qdrant on `host.docker.internal:6333` (collection: `pdf_chunks`).
- **Embedding**: Uses `sentence-transformers/all-MiniLM-L6-v2` locally to embed queries (must match ingest pipeline).
- **Network**: `rag-api` talks to `llm-runtime` via Docker network `http://llm-runtime:8081`.

## 6. Setup Instructions
1. **Download Model**:
   ```bash
   pip install huggingface_hub
   python rag-service/scripts/download_model.py
   ```
2. **Start Services**:
   ```bash
   cd rag-service
   docker-compose up --build
   ```
