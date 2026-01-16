
import os
import json
import logging
import boto3
import hashlib
from datetime import datetime, timezone
import typesense

# Configuration
BUCKET = os.environ.get("BUCKET", "pdf-reader-uploads-aditya")
EMBED_BATCH_QUEUE_URL = os.environ.get("EMBED_BATCH_QUEUE_URL")
BATCH_SIZE = 50 

# Typesense Config
TYPESENSE_HOST = os.environ.get("TYPESENSE_HOST", "localhost")
TYPESENSE_PORT = os.environ.get("TYPESENSE_PORT", "8108")
TYPESENSE_API_KEY = os.environ.get("TYPESENSE_API_KEY", "my-secret-typesense-key")
TYPESENSE_PROTOCOL = os.environ.get("TYPESENSE_PROTOCOL", "http")

s3 = boto3.client("s3")
sqs = boto3.client("sqs")
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Typesense
ts_client = typesense.Client({
  'nodes': [{
    'host': TYPESENSE_HOST,
    'port': TYPESENSE_PORT,
    'protocol': TYPESENSE_PROTOCOL
  }],
  'api_key': TYPESENSE_API_KEY,
  'connection_timeout_seconds': 2
})

def ensure_typesense_collection():
    schema = {
        'name': 'pdf_chunks',
        'fields': [
            {'name': 'docId', 'type': 'string', 'facet': True},
            {'name': 'text', 'type': 'string'},
            {'name': 'page', 'type': 'int32', 'facet': True},
            {'name': 'chunkId', 'type': 'string'},
            {'name': 'userId', 'type': 'string', 'facet': True}
        ],
        'default_sorting_field': 'page'
    }
    try:
        ts_client.collections['pdf_chunks'].retrieve()
    except Exception:
        ts_client.collections.create(schema)

def get_chunks_from_sidecar(sidecar, target_tokens=500, overlap=0.2):
    tokens = sidecar.get("tokens", [])
    if not tokens:
        return []

    chunks = []
    start_idx = 0
    step = int(target_tokens * (1 - overlap))

    while start_idx < len(tokens):
        end_idx = min(start_idx + target_tokens, len(tokens))
        
        scan_back = min(50, end_idx - start_idx)
        for k in range(end_idx - 1, end_idx - scan_back - 1, -1):
            if "." in tokens[k].get("text", ""):
                 end_idx = k + 1
                 break
        
        subset = tokens[start_idx:end_idx]
        text = " ".join([t.get("text","") for t in subset])
        
        doc_id = sidecar.get("docId")
        sig = f"v1|{doc_id}|{start_idx}|{end_idx}"
        chunk_id = hashlib.sha256(sig.encode("utf-8")).hexdigest()

        chunks.append({
            "chunkId": chunk_id,
            "text": text,
            "docId": doc_id,
            "userId": sidecar.get("userId", "unknown"),
            "page": sidecar.get("page"),
            "tokensRange": [start_idx, end_idx]
        })

        start_idx += step
        if start_idx >= len(tokens) and len(chunks) > 0:
            break

    return chunks

def handler(event, context):
    ensure_typesense_collection()
    
    for rec in event.get("Records", []):
        try:
            body = json.loads(rec["body"])
            doc_id = body.get("docId")
            sidecar_key = body.get("sidecarKey")
            
            logger.info(f"Chunking: {sidecar_key}")
            
            r = s3.get_object(Bucket=BUCKET, Key=sidecar_key)
            sidecar = json.loads(r["Body"].read())
            
            # Pass userId if missing in body but present in sidecar path/manifest
            # For now assume sidecar implies context
            
            chunks = get_chunks_from_sidecar(sidecar)
            logger.info(f"Generated {len(chunks)} chunks.")

            if not chunks:
                continue

            # 1. Index to Typesense (Keyword Search)
            ts_documents = [{
                'id': c['chunkId'], # Typesense ID
                'chunkId': c['chunkId'],
                'docId': c['docId'],
                'text': c['text'],
                'page': c['page'],
                'userId': c['userId']
            } for c in chunks]
            
            # Upsert to Typesense
            ts_client.collections['pdf_chunks'].documents.import_(ts_documents, {'action': 'upsert'})
            logger.info(f"Indexed {len(chunks)} chunks to Typesense.")

            # 2. Update Sidecar Metadata
            # Store typesenseId (= chunkId) and clear text to save space if desired
            chunks_meta = [{k:v for k,v in c.items() if k != "text"} for c in chunks]
            for cm in chunks_meta:
                cm['typesenseId'] = cm['chunkId']
                
            sidecar["chunks"] = chunks_meta
            sidecar["processing"]["chunkedAt"] = datetime.now(timezone.utc).isoformat()
            
            s3.put_object(Bucket=BUCKET, Key=sidecar_key, Body=json.dumps(sidecar).encode("utf-8"))

            # 3. Enqueue for Embeddings (Qdrant)
            for i in range(0, len(chunks), BATCH_SIZE):
                batch = chunks[i:i+BATCH_SIZE]
                msg = {
                    "jobType": "EMBED_BATCH",
                    "docId": doc_id,
                    "chunks": batch 
                }
                sqs.send_message(QueueUrl=EMBED_BATCH_QUEUE_URL, MessageBody=json.dumps(msg))
                logger.info(f"Enqueued batch {i//BATCH_SIZE + 1} for embedding.")

        except Exception as e:
            logger.error(f"Failed chunking: {e}")
            raise 

    return {"status": "success"}
