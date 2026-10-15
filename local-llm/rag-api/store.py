"""One Qdrant client for the whole service.

With QDRANT_URL set, the service talks to a Qdrant server (the Docker setup).
Otherwise Qdrant runs embedded in this process and keeps its data under
QDRANT_PATH, so the assistant needs no Docker. Embedded storage allows a single
client per folder, which is why every module takes its client from here.
"""

import os
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

PASSAGES = "pdf_chunks"
CONCEPTS = "okf_concepts"
DIMENSION = 384  # all-MiniLM-L6-v2

QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
QDRANT_PATH = os.getenv("QDRANT_PATH", str(Path(__file__).resolve().parents[1] / "data/qdrant"))

_client = None
# Bumped on every write, so cached retrieval indexes know they are stale.
generation = 0


def get_qdrant():
    global _client
    if _client is None:
        _client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY) if QDRANT_URL else QdrantClient(path=QDRANT_PATH)
    return _client


def set_qdrant(client):
    """Tests and the offline evaluation use an in-memory client."""
    global _client
    _client = client
    changed()


def changed():
    global generation
    generation += 1


def ensure_collection(name):
    client = get_qdrant()
    if not client.collection_exists(name):
        client.create_collection(name, vectors_config=VectorParams(size=DIMENSION, distance=Distance.COSINE))
