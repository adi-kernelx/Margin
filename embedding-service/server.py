from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List

app = FastAPI()

print("[Embedding] Loading model...")
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
print("[Embedding] Model loaded")

class EmbedRequest(BaseModel):
    texts: List[str]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/embed")
def embed(req: EmbedRequest):
    embeddings = model.encode(req.texts, normalize_embeddings=True)
    return {
        "count": len(req.texts),
        "dim": len(embeddings[0]),
        "embeddings": embeddings.tolist()
    }
