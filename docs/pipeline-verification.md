# Pipeline Verification Guide

To verify that OCR, Chunking, and Embedding generation are working correctly, you need to run the worker pipeline components locally.

## Prerequisites
1. Ensure `S3_BUCKET`, `AWS_REGION` etc are set in `.env`.
2. Ensure you have Python 3.9+ installed.
3. Install Python dependencies:
   ```bash
   pip install -r backend/lambda/chunk-worker/requirements.txt
   pip install -r backend/lambda/embed-worker/requirements.txt
   ```

## Running the Pipeline

Run these 4 processes in separate terminals:

### 1. Backend API (Express)
Serves the API and handles the initial `POST /ocr/start` enqueue.
```bash
cd backend
npm run dev
```

### 2. OCR Worker (Node.js)
Consumes `ocr-page-ingest`, runs Vision API, and triggers chunking.
```bash
cd backend
npx ts-node src/workers/ocr-worker.ts
```

### 3. Chunk Worker (Python)
Consumes `embedding-page-ingest`, chunks text, indexes to Typesense, and triggers embedding.
```bash
cd backend/lambda/chunk-worker
# Ensure .env vars are exported or loadable
python worker.py
```

### 4. Embedder Worker (Python)
Consumes `embedding-batch-ingest`, generates vectors, and indexes to Qdrant.
```bash
cd backend/lambda/embed-worker
# Ensure .env vars are exported or loadable
python worker.py
```

## Verification Steps
1. **Trigger**: Open a PDF in the Frontend.
2. **Observe Logs**: Watch the terminals for successful processing messages.
3. **Artifacts**: Check S3 for updated `manifest.json` (status: complete) and populated `ocr/page-*.json` sidecars (with chunks).
