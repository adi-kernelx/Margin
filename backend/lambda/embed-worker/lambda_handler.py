
import os
import json
import logging
import boto3
from qdrant_client import QdrantClient
from qdrant_client.http import models

# Configuration
REGION = os.environ.get("AWS_REGION", "ap-south-1")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", None)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

import typesense

# Typesense Config
TYPESENSE_HOST = os.environ.get("TYPESENSE_HOST", "localhost")
TYPESENSE_PORT = os.environ.get("TYPESENSE_PORT", "8108")
TYPESENSE_API_KEY = os.environ.get("TYPESENSE_API_KEY", "my-secret-typesense-key")
TYPESENSE_PROTOCOL = os.environ.get("TYPESENSE_PROTOCOL", "http")

# Initialize Clients
q_client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
ts_client = typesense.Client({
  'nodes': [{
    'host': TYPESENSE_HOST,
    'port': TYPESENSE_PORT,
    'protocol': TYPESENSE_PROTOCOL
  }],
  'api_key': TYPESENSE_API_KEY,
  'connection_timeout_seconds': 2
})

def ensure_qdrant_collection():
    try:
        q_client.get_collection("pdf_chunks")
    except Exception:
        q_client.create_collection(
            collection_name="pdf_chunks",
            vectors_config=models.VectorParams(size=1536, distance=models.Distance.COSINE)
        )

def get_embeddings(texts):
    # Mock Embedding - Replace with Bedrock / OpenAI
    dim = 1536
    return [[0.1] * dim for _ in texts]

def handler(event, context):
    ensure_qdrant_collection()

    for rec in event.get("Records", []):
        try:
            body = json.loads(rec["body"])
            if body.get("jobType") != "EMBED_BATCH":
                continue

            chunks = body.get("chunks", [])
            if not chunks:
                continue

            logger.info(f"Embedding batch of {len(chunks)} chunks...")
            
            texts = [c["text"] for c in chunks]
            vectors = get_embeddings(texts)

            # Upsert to Qdrant
            points = []
            for i, chunk in enumerate(chunks):
                points.append(models.PointStruct(
                    id=chunk["chunkId"], 
                    vector=vectors[i],
                    payload={
                        "docId": chunk["docId"],
                        "page": chunk["page"],
                        "text": chunk["text"], 
                        "userId": chunk["userId"],
                        "tokensRange": chunk["tokensRange"]
                    }
                ))
            
            q_client.upsert(
                collection_name="pdf_chunks",
                points=points
            )
            logger.info(f"Upserted {len(points)} vectors to Qdrant.")

            # Update Typesense 'indexedVectors' flag
            try:
                for chunk in chunks:
                    ts_client.collections['pdf_chunks'].documents[chunk['chunkId']].update({
                        'indexedVectors': True
                    })
            except Exception as e:
                logger.warning(f"Failed to update Typesense status for batch: {e}")

        except Exception as e:
            logger.error(f"Embedder failed: {e}")
            raise 

    return {"status": "success"}
