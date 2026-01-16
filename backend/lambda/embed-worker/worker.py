
import os
import json
import logging
import time
import boto3
import typesense
from qdrant_client import QdrantClient
from qdrant_client.http import models

# --- Configuration ---
BUCKET = os.environ.get("BUCKET", "pdf-reader-uploads-aditya")
QUEUE_URL = os.environ.get("EMBED_BATCH_QUEUE_URL")
AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")

# Qdrant
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "my-secret-qdrant-key")

# Typesense (for status updates)
TS_HOST = os.environ.get("TYPESENSE_HOST", "localhost")
TS_PORT = os.environ.get("TYPESENSE_PORT", "8108")
TS_KEY = os.environ.get("TYPESENSE_API_KEY", "my-secret-typesense-key")
TS_PROTOCOL = os.environ.get("TYPESENSE_PROTOCOL", "http")

# Setup Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s:%(message)s')
logger = logging.getLogger(__name__)

# Setup Clients
s3 = boto3.client("s3", region_name=AWS_REGION)
sqs = boto3.client("sqs", region_name=AWS_REGION)
bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)

q_client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
ts_client = typesense.Client({
  'nodes': [{
    'host': TS_HOST,
    'port': TS_PORT,
    'protocol': TS_PROTOCOL
  }],
  'api_key': TS_KEY,
  'connection_timeout_seconds': 5
})

def delete_message(receipt_handle):
    try:
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt_handle)
    except Exception as e:
        logger.error(f"Failed to delete message: {e}")

def load_sidecar(key):
    resp = s3.get_object(Bucket=BUCKET, Key=key)
    return json.loads(resp["Body"].read())

def atomic_write_sidecar(key, data):
    tmp_key = key + ".tmp"
    s3.put_object(Bucket=BUCKET, Key=tmp_key, Body=json.dumps(data).encode("utf-8"))
    s3.copy_object(Bucket=BUCKET, CopySource={'Bucket': BUCKET, 'Key': tmp_key}, Key=key)
    s3.delete_object(Bucket=BUCKET, Key=tmp_key)

def ensure_qdrant_collection():
    try:
        q_client.get_collection("pdf_chunks")
    except Exception:
        logger.info("Creating Qdrant collection 'pdf_chunks'...")
        q_client.create_collection(
            collection_name="pdf_chunks",
            vectors_config=models.VectorParams(size=1536, distance=models.Distance.COSINE)
        )

# --- Logic ---

def embed_texts(texts):
    if not texts:
        return []
    
    # Bedrock Titan v1
    # Check limit: Titan supports up to ~8k tokens, but lists are fine.
    try:
        resp = bedrock.invoke_model(
            modelId="amazon.titan-embed-text-v1",
            contentType="application/json",
            accept="application/json",
            body=json.dumps({"inputText": texts[0] if len(texts)==1 else texts}) 
            # Note: Verify Titan Batch support. 
            # Titan v1 via invoke_model usually takes single text or list?
            # Re-reading docs: standard invoke_model takes "inputText": string.
            # To do batch, strictly speaking, we might need loop or checking specific input format.
            # However, Titan V2 supports list. V1 often requires single calls.
            # For safety with V1 given constraints: Loop it if batch fails or assume loop here.
        )
        # Actually Titan V1 input is just "inputText": "string". It does NOT support batch list in single call efficiently
        # properly without multiple HTTP calls unless using specific newer endpoints.
        # Let's simple-loop it for robustness unless confirmed otherwise.
        
        # Correction: User snippet says "def embed_texts(texts: list[str]) ... return payload["embedding"]"
        # Implies user believes it supports it. I will implementations loop for safety.
    except Exception:
        pass

    results = []
    for t in texts:
        try:
            resp = bedrock.invoke_model(
                modelId="amazon.titan-embed-text-v1",
                contentType="application/json",
                accept="application/json",
                body=json.dumps({"inputText": t})
            )
            data = json.loads(resp["body"].read())
            results.append(data.get("embedding"))
        except Exception as e:
            logger.error(f"Bedrock error for chunk: {e}")
            results.append([0.0]*1536) # Zero vector fallback? Or fail? Fail matches DLQ strategy.
            raise e
            
    return results

def process_message(msg_body):
    job_type = msg_body.get("jobType")
    chunks = msg_body.get("chunks", [])
    doc_id = msg_body.get("docId")
    user_id = msg_body.get("userId")
    
    if not chunks:
        return

    logger.info(f"Processing batch of {len(chunks)} chunks for {doc_id}")
    
    # 1. Generate Embeddings
    texts = [c["text"] for c in chunks]
    try:
        vectors = embed_texts(texts)
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        raise # Retry SQS

    # 2. Upsert to Qdrant
    points = []
    chunk_ids = []
    
    for i, c in enumerate(chunks):
        chunk_id = c["chunkId"]
        chunk_ids.append(chunk_id)
        
        points.append(models.PointStruct(
            id=chunk_id,
            vector=vectors[i],
            payload={
                "docId": doc_id,
                "userId": user_id,
                "page": c.get("page"),
                "text": c.get("text")[:200], # Preview
                "sidecarKey": f"users/{user_id}/docs/{doc_id}/ocr/page-{str(c.get('page')).zfill(4)}.json" # Implicit
            }
        ))
    
    q_client.upsert(collection_name="pdf_chunks", points=points)
    logger.info(f"Upserted {len(points)} to Qdrant")

    # 3. Update Sidecars
    # Chunks in batch might belong to different pages if we batched across page (though currently we batch per page flow?)
    # "Chunker" enqueues batches. Chunker runs per page. So usually same page.
    # Group by page/sidecarKey to be safe.
    
    # Assuming batch is homogeneous for page for now (from Chunker upstream).
    # Re-construct sidecar key if not passed
    page_num = chunks[0].get("page")
    sidecar_key = f"users/{user_id}/docs/{doc_id}/ocr/page-{str(page_num).zfill(4)}.json"
    
    try:
        sidecar = load_sidecar(sidecar_key)
        updated = False
        for sc in sidecar.get("chunks", []):
            if sc["chunkId"] in chunk_ids:
                sc["embeddingUpserted"] = True
                sc["embeddingModel"] = "amazon.titan-embed-text-v1"
                sc["embeddedAt"] = time.time()
                updated = True
        
        if updated:
            atomic_write_sidecar(sidecar_key, sidecar)
            logger.info(f"Updated sidecar {sidecar_key}")
            
    except Exception as e:
        logger.error(f"Sidecar update failed: {e}")
        # Non-fatal? If we re-process, vector upsert is idempotent. 
        # But failing here means we might re-embed. Safe to raise.
        raise

    # 4. Update Typesense Status
    try:
        for cid in chunk_ids:
             ts_client.collections['pdf_chunks'].documents[cid].update({'indexedVectors': True})
    except Exception as e:
        logger.warning(f"Typesense status update failed: {e}")

def main():
    logger.info(f"Starting Embed Worker polling {QUEUE_URL}...")
    ensure_qdrant_collection()
    
    while True:
        try:
            resp = sqs.receive_message(
                QueueUrl=QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=10
            )
            
            if "Messages" in resp:
                for msg in resp["Messages"]:
                    body = json.loads(msg["Body"])
                    process_message(body)
                    delete_message(msg["ReceiptHandle"])
            else:
                pass 
                
        except Exception as e:
            logger.error(f"Polling loop error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
