# OCR Sidecar Ingestion System

This system ingests OCR data from PDF Reader into Qdrant for semantic search.

## Features

- ✅ **Embedding caching** - Uses PDF fingerprint to avoid re-generating embeddings
- ✅ **Idempotent upserts** - Deterministic chunk IDs prevent duplicates
- ✅ **Multiple formats** - Handles IndexedDB exports, native+OCR hybrid, etc.
- ✅ **Batch processing** - Efficient embedding in batches

## Setup

```bash
cd ingest-sidecars
pip install -r requirements.txt
```

## Usage

### Step 1: Export OCR data from browser

1. Open your PDF Reader app in the browser
2. Open any PDFs you want to search (OCR will run automatically)
3. Open DevTools (F12) → Console
4. Copy and paste the contents of `export_ocr_from_browser.js`
5. Press Enter - JSON files will download
6. Move the downloaded `sidecar-*.json` files to `./sidecars/`

### Step 2: Run ingestion

```bash
# Make sure services are running:
# - Qdrant at localhost:6333
# - Embedding API at localhost:9000

python ingest_sidecars.py --folder ./sidecars
```

### Options

```bash
python ingest_sidecars.py --help

--folder, -f     Folder with sidecar JSONs (default: ./sidecars)
--batch, -b      Embedding batch size (default: 64)
--max-chars, -m  Max characters per chunk (default: 800)
--force          Re-embed even if already cached
```

## How caching works

The script stores embeddings in a local SQLite database (`embedding_cache.db`).

| PDF A opens | Embedding generated | Cached? |
|-------------|---------------------|---------|
| First time  | Yes                 | ✅ Saved |
| Same PDF again | No (uses cache)  | ✅ Reused |
| Different PDF | Yes              | ✅ Saved |

To force re-embedding:
```bash
python ingest_sidecars.py --force
```

## Sidecar format

The script accepts multiple formats:

### Format A: IndexedDB Export (from browser script)
```json
{
  "localFileId": "abc-123",
  "pdfFingerprint": "65144652bd14c3741164a82943a65502",
  "ocrData": {
    "1": { "tokens": [...], "avgConfidence": 95 },
    "2": { "tokens": [...], "avgConfidence": 92 }
  }
}
```

### Format B: Per-page OCR
```json
{
  "docId": "my-document",
  "page": 1,
  "tokens": [
    { "text": "Hello", "bbox": {"x0": 0.1, "y0": 0.1, "x1": 0.2, "y1": 0.15} }
  ]
}
```

## Verify ingestion

```bash
# Check Qdrant dashboard
# Open: http://localhost:6333/dashboard
# Collection: pdf_chunks → should show points

# Test search
cd ../ingest-pipeline
python search.py
# Enter query and see results
```

## Directory structure

```
ingest-sidecars/
├── requirements.txt
├── ingest_sidecars.py      # Main ingestion script
├── export_ocr_from_browser.js  # Browser export script
├── embedding_cache.db      # SQLite cache (created on first run)
├── sidecars/              # Put sidecar JSONs here
│   ├── sidecar-abc123.json
│   └── sidecar-def456.json
└── README.md
```
