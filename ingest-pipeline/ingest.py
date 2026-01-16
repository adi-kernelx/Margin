import requests
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
import hashlib
import uuid

QDRANT_URL = "http://localhost:6333"
COLLECTION = "pdf_chunks"
EMBEDDING_API = "http://localhost:9000/embed"

client = QdrantClient(url=QDRANT_URL)


def deterministic_id(doc_id, page, text):
    """Generate a deterministic UUID from doc_id, page, and text."""
    key = f"{doc_id}|{page}|{text}"
    # Create a UUID from the hash (use first 16 bytes of SHA256)
    hash_bytes = hashlib.sha256(key.encode()).digest()[:16]
    return str(uuid.UUID(bytes=hash_bytes))


def embed_texts(texts):
    resp = requests.post(
        EMBEDDING_API,
        json={"texts": texts},
        timeout=60
    )
    resp.raise_for_status()
    return resp.json()["embeddings"]


def ingest_chunks(chunks):
    texts = [c["text"] for c in chunks]
    embeddings = embed_texts(texts)

    points = []
    for chunk, vector in zip(chunks, embeddings):
        pid = deterministic_id(chunk["docId"], chunk["page"], chunk["text"])

        points.append(
            PointStruct(
                id=pid,
                vector=vector,
                payload={
                    "docId": chunk["docId"],
                    "page": chunk["page"],
                    "text": chunk["text"],
                    "bbox": chunk["bbox"],
                    "spanCount": chunk["spanCount"],
                }
            )
        )

    client.upsert(collection_name=COLLECTION, points=points)
    print(f"[Ingest] Upserted {len(points)} chunks")


# --- Example manual test ---
if __name__ == "__main__":
    example_chunks = [
        {
            "docId": "demo-doc",
            "page": 1,
            "text": "Neural networks are powerful tools for pattern recognition.",
            "bbox": {"x0": 0.1, "y0": 0.2, "x1": 0.8, "y1": 0.3},
            "spanCount": 4
        },
        {
            "docId": "demo-doc",
            "page": 1,
            "text": "Transformers have revolutionized natural language processing.",
            "bbox": {"x0": 0.1, "y0": 0.35, "x1": 0.85, "y1": 0.45},
            "spanCount": 5
        }
    ]

    ingest_chunks(example_chunks)
