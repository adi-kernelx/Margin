
import os
import json
import logging
import time
import boto3
import uuid
import hashlib
import typesense
from datetime import datetime, timezone

# --- Configuration ---
BUCKET = os.environ.get("BUCKET", "pdf-reader-uploads-aditya")
SQS_QUEUE_URL = os.environ.get("EMBED_PAGE_QUEUE_URL") # Input Queue
EMBED_BATCH_URL = os.environ.get("EMBED_BATCH_QUEUE_URL") # Output Queue
AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")

# Typesense
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
        sqs.delete_message(QueueUrl=SQS_QUEUE_URL, ReceiptHandle=receipt_handle)
    except Exception as e:
        logger.error(f"Failed to delete message: {e}")

def load_sidecar(key):
    resp = s3.get_object(Bucket=BUCKET, Key=key)
    return json.loads(resp["Body"].read())

def atomic_write_sidecar(key, data):
    # tmp write -> copy -> delete
    tmp_key = key + ".tmp"
    s3.put_object(Bucket=BUCKET, Key=tmp_key, Body=json.dumps(data).encode("utf-8"))
    s3.copy_object(Bucket=BUCKET, CopySource={'Bucket': BUCKET, 'Key': tmp_key}, Key=key)
    s3.delete_object(Bucket=BUCKET, Key=tmp_key)

# --- Chunking Logic ---

def build_chunks(sidecar, version=1):
    tokens = sidecar.get("tokens", [])
    lines = sidecar.get("lines", [])
    if not tokens:
        return []

    # 1. Simple heuristic: Group lines into paragraphs based on vertical distance
    # For now, we'll stream tokens and split by sentence/length (simpler & robust)
    
    chunks = []
    target_tokens = 500
    overlap = 50
    
    start_idx = 0
    step = target_tokens - overlap
    
    doc_id = sidecar.get("docId", "unknown")
    
    while start_idx < len(tokens):
        end_idx = min(start_idx + target_tokens, len(tokens))
        
        # Sentence boundary adjustment
        scan_back = min(50, end_idx - start_idx)
        for k in range(end_idx - 1, end_idx - scan_back - 1, -1):
             t_text = tokens[k].get("text", "")
             if "." in t_text or "!" in t_text or "?" in t_text:
                 end_idx = k + 1
                 break

        subset_tokens = tokens[start_idx:end_idx]
        text_content = " ".join([t.get("text", "") for t in subset_tokens])
        
        # Deterministic ID
        sig = f"v{version}|{doc_id}|{start_idx}|{end_idx}"
        chunk_id = hashlib.sha256(sig.encode("utf-8")).hexdigest()
        
        # Calculate BBox union (min x, min y, max x, max y)
        min_x, min_y = 1.0, 1.0
        max_x, max_y = 0.0, 0.0
        conf_sum = 0
        
        for t in subset_tokens:
            b = t.get("bbox", {})
            if b:
                min_x = min(min_x, b.get("x", 0))
                min_y = min(min_y, b.get("y", 0))
                max_x = max(max_x, b.get("x", 0) + b.get("w", 0))
                max_y = max(max_y, b.get("y", 0) + b.get("h", 0))
            conf_sum += t.get("confidence", 0)

        avg_conf = conf_sum / len(subset_tokens) if subset_tokens else 0
        
        chunk = {
            "chunkId": chunk_id,
            "textPreview": text_content[:200], # store preview
            "fullText": text_content, # Transient, don't necessarily need to store in sidecar chunks[] if huge
            "tokensRange": [start_idx, end_idx],
            "pageRange": [sidecar.get("page", 0)],
            "bbox": {"x": min_x, "y": min_y, "w": max_x - min_x, "h": max_y - min_y},
            "typesenseId": chunk_id,
            "embeddingUpserted": False,
            "chunkerVersion": version,
            "confidence": avg_conf
        }
        chunks.append(chunk)

        start_idx += step
        if start_idx >= len(tokens):
            break

    return chunks

def process_message(msg_body):
    job_type = msg_body.get("jobType") # Expect CHUNK_PAGE or implicit
    # Support routing from OCR complete (which might send 'OCR_PAGE_JOB' style or EventBridge event)
    # The requirement says: ocr-complete -> embedding-page-ingest
    # So the msg might represent the event.
    
    # Extract fields
    doc_id = msg_body.get("docId") or msg_body.get("detail", {}).get("docId")
    user_id = msg_body.get("userId") or msg_body.get("detail", {}).get("userId")
    page = msg_body.get("page") or msg_body.get("detail", {}).get("page")
    sidecar_key = msg_body.get("sidecarKey") or msg_body.get("detail", {}).get("sidecarKey")
    
    # If sidecarKey not present, construct it
    if not sidecar_key and doc_id and user_id and page is not None:
        sidecar_key = f"users/{user_id}/docs/{doc_id}/ocr/page-{str(page).zfill(4)}.json"
    
    if not sidecar_key:
        logger.error(f"Missing sidecarKey in msg: {msg_body}")
        return

    logger.info(f"Processing {sidecar_key}")
    
    # 1. Fetch Sidecar
    try:
        sidecar = load_sidecar(sidecar_key)
    except Exception as e:
        logger.error(f"Sidecar not found: {e}")
        return

    # 2. Idempotency Check
    force = msg_body.get("force", False)
    existing_chunks = sidecar.get("chunks", [])
    if existing_chunks and not force:
        # Check version
        if existing_chunks[0].get("chunkerVersion") == 1:
            logger.info("Skipping - already chunked v1")
            return

    # 3. Build Chunks
    new_chunks = build_chunks(sidecar)
    logger.info(f"Generated {len(new_chunks)} chunks")

    # 4. Save to Sidecar
    # Strip fullText from sidecar storage to save space, rely on tokens or preview
    storage_chunks = []
    for c in new_chunks:
        c_store = c.copy()
        del c_store["fullText"] # Remove huge text
        storage_chunks.append(c_store)
        
    sidecar["chunks"] = storage_chunks
    atomic_write_sidecar(sidecar_key, sidecar)
    
    # 5. Index to Typesense
    ts_docs = []
    created_at = int(time.time())
    for c in new_chunks:
        ts_docs.append({
            "chunkId": c["chunkId"],
            "docId": doc_id,
            "userId": user_id,
            "page": int(page) if page is not None else 0,
            "text": c["fullText"], # Index full text here
            "confidence": c["confidence"],
            "createdAt": created_at,
            "indexedVectors": False
        })
    
    if ts_docs:
        try:
            ts_client.collections['pdf_chunks'].documents.import_(ts_docs, {'action': 'upsert'})
            logger.info(f"Indexed {len(ts_docs)} chunks to Typesense")
        except Exception as e:
            logger.error(f"Typesense failed: {e}")
            raise # Retry message

    # 6. Enqueue Embedding Jobs
    batch_size = 50
    msgs_to_send = []
    
    # Flatten chunks into batch messages
    # The requirement says: enqueue embedding-batch-ingest
    # Message: { jobType: "EMBED_BATCH", chunks: [...] } or individual?
    # Requirement: "Enqueue batch jobs"
    
    current_batch = []
    for c in new_chunks:
        chunk_payload = {
            "chunkId": c["chunkId"],
            "docId": doc_id,
            "userId": user_id,
            "page": page,
            "text": c["fullText"],
            "tokensRange": c["tokensRange"]
        }
        current_batch.append(chunk_payload)
        
        if len(current_batch) >= batch_size:
            msgs_to_send.append(current_batch)
            current_batch = []
            
    if current_batch:
        msgs_to_send.append(current_batch)
        
    for batch in msgs_to_send:
        msg = {
            "jobType": "EMBED_BATCH",
            "docId": doc_id,
            "chunks": batch
        }
        sqs.send_message(QueueUrl=EMBED_BATCH_URL, MessageBody=json.dumps(msg))
    
    logger.info(f"Enqueued {len(msgs_to_send)} batches for embedding")


def main():
    logger.info(f"Starting Chunker Worker polling {SQS_QUEUE_URL}...")
    while True:
        try:
            resp = sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=10
            )
            
            if "Messages" in resp:
                for msg in resp["Messages"]:
                    body = json.loads(msg["Body"])
                    process_message(body)
                    delete_message(msg["ReceiptHandle"])
            else:
                pass # No messages
                
        except Exception as e:
            logger.error(f"Polling loop error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
