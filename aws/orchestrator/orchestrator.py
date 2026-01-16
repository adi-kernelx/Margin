"""
OCR Orchestrator Service
- Receives page images from clients
- Calls OCR service
- Persists sidecars to S3 with atomic writes
- Updates Firestore manifests
- Enqueues chunker/embedding jobs to SQS
"""
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
import time
import hashlib
import json
import os
import boto3
from google.cloud import firestore
from botocore.exceptions import ClientError
from typing import Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OCR Orchestrator", version="1.0.0")

# CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
S3_BUCKET = os.environ.get("S3_BUCKET", "pdf-reader-uploads-aditya")
OCR_URL = os.environ.get("OCR_URL", "http://paddleocr-service:8000/ocr")
SQS_QUEUE_URL = os.environ.get("SQS_QUEUE_URL", "")
AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")

# AWS clients
s3 = boto3.client("s3", region_name=AWS_REGION)
sqs = boto3.client("sqs", region_name=AWS_REGION) if SQS_QUEUE_URL else None

# Firestore client
db = firestore.Client()


def make_sidecar_key(user_id: str, doc_id: str, page_number: int, ocr_version: str) -> str:
    """Generate deterministic S3 key for sidecar"""
    # Sanitize ocr_version for S3 key
    safe_version = ocr_version.replace(":", "-").replace("/", "-")
    return f"users/{user_id}/docs/{doc_id}/pages/page-{page_number:04d}.sidecar.{safe_version}.json"


def make_local_sidecar_key(user_id: str, pdf_hash: str, page_number: int, ocr_version: str) -> str:
    """Generate S3 key for local (non-cloud) files"""
    safe_version = ocr_version.replace(":", "-").replace("/", "-")
    safe_hash = pdf_hash[:32] if pdf_hash else "unknown"
    return f"users/{user_id}/local/{safe_hash}/pages/page-{page_number:04d}.sidecar.{safe_version}.json"


def deterministic_request_id(pdf_hash: str, page_number: int, ocr_version: str) -> str:
    """Generate deterministic request ID for idempotency"""
    key = f"{pdf_hash}:{page_number}:{ocr_version}"
    return hashlib.sha256(key.encode()).hexdigest()


def check_existing_sidecar(bucket: str, key: str) -> Optional[dict]:
    """Check if sidecar already exists in S3"""
    try:
        response = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(response['Body'].read().decode('utf-8'))
    except ClientError as e:
        if e.response["Error"]["Code"] in ["404", "NoSuchKey"]:
            return None
        raise


def atomic_write_sidecar(bucket: str, final_key: str, tmp_key: str, sidecar: dict):
    """Atomic write: tmp -> copy -> delete tmp"""
    sidecar_json = json.dumps(sidecar, ensure_ascii=False)
    
    # Write to tmp
    s3.put_object(
        Bucket=bucket,
        Key=tmp_key,
        Body=sidecar_json.encode("utf-8"),
        ContentType="application/json"
    )
    
    # Copy to final location
    copy_source = {"Bucket": bucket, "Key": tmp_key}
    s3.copy_object(Bucket=bucket, CopySource=copy_source, Key=final_key)
    
    # Delete tmp
    s3.delete_object(Bucket=bucket, Key=tmp_key)
    
    logger.info(f"Sidecar persisted to s3://{bucket}/{final_key}")


def update_firestore_manifest(user_id: str, doc_id: str, page_number: int, 
                               s3_key: str, ocr_version: str, sidecar: dict, 
                               pdf_hash: str, is_local: bool = False):
    """Update Firestore manifest with sidecar info"""
    manifest_ref = db.collection("users").document(user_id).collection("docs").document(doc_id)
    
    manifest = manifest_ref.get().to_dict() or {}
    sidecars = manifest.get("sidecars", {})
    
    sidecars[str(page_number)] = {
        "s3Key": s3_key,
        "ocrVersion": ocr_version,
        "createdAt": sidecar.get("createdAt", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
        "avgConfidence": sidecar.get("summary", {}).get("avgConfidence", 0),
        "wordCount": sidecar.get("summary", {}).get("wordCount", 0)
    }
    
    manifest.update({
        "docId": doc_id,
        "pdfHash": pdf_hash,
        "sidecars": sidecars,
        "isLocal": is_local,
        "lastUpdatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    })
    
    manifest_ref.set(manifest, merge=True)
    logger.info(f"Firestore manifest updated for {user_id}/{doc_id} page {page_number}")


def enqueue_chunker_job(user_id: str, doc_id: str, page_number: int, s3_key: str, pdf_hash: str):
    """Enqueue job for chunker/embedding pipeline"""
    if not sqs or not SQS_QUEUE_URL:
        logger.warning("SQS not configured, skipping chunker enqueue")
        return
    
    message = {
        "type": "PAGE_OCR_COMPLETE",
        "userId": user_id,
        "docId": doc_id,
        "pageNumber": page_number,
        "s3Key": s3_key,
        "pdfHash": pdf_hash,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    sqs.send_message(
        QueueUrl=SQS_QUEUE_URL,
        MessageBody=json.dumps(message),
        MessageGroupId=doc_id if ".fifo" in SQS_QUEUE_URL else None
    )
    logger.info(f"Chunker job enqueued for {doc_id} page {page_number}")


@app.get("/health")
def health():
    return {"status": "ok", "service": "orchestrator"}


@app.post("/process-page")
async def process_page(
    userId: str = Form(...),
    docId: Optional[str] = Form(None),
    pageNumber: int = Form(...),
    pdfHash: Optional[str] = Form(None),
    totalPages: Optional[int] = Form(None),
    file: UploadFile = File(...)
):
    """
    Process a single page:
    1. Call OCR service
    2. Persist sidecar to S3
    3. Update Firestore manifest
    4. Enqueue chunker job
    """
    logger.info(f"Processing page {pageNumber} for user {userId}, docId={docId}, pdfHash={pdfHash}")
    
    try:
        # Read file content
        file_content = await file.read()
        
        # 1) Call OCR service
        files = {"file": (file.filename or f"page-{pageNumber}.png", file_content, "image/png")}
        data = {
            "docId": docId or "",
            "pageNumber": str(pageNumber),
            "pdfHash": pdfHash or ""
        }
        
        ocr_response = requests.post(OCR_URL, files=files, data=data, timeout=120)
        ocr_response.raise_for_status()
        sidecar = ocr_response.json()
        
        if "error" in sidecar:
            raise HTTPException(status_code=500, detail=sidecar["error"])
        
        ocr_version = sidecar.get("ocrVersion", "unknown")
        pdf_hash = pdfHash or sidecar.get("pdfHash") or "unknown-hash"
        
        # Determine if this is a cloud doc or local file
        is_local = docId is None or docId.startswith("local-")
        doc_id = docId or f"local-{pdf_hash[:16]}"
        
        # 2) Generate S3 key and check for existing
        if is_local:
            final_key = make_local_sidecar_key(userId, pdf_hash, pageNumber, ocr_version)
        else:
            final_key = make_sidecar_key(userId, doc_id, pageNumber, ocr_version)
        
        # Check if already exists (smart-skip)
        existing = check_existing_sidecar(S3_BUCKET, final_key)
        if existing:
            existing_version = existing.get("ocrVersion", "")
            if existing_version == ocr_version:
                logger.info(f"Sidecar already exists at {final_key}, skipping")
                return {
                    "status": "exists",
                    "s3Key": final_key,
                    "sidecar": existing
                }
        
        # 3) Atomic write to S3
        tmp_key = f"_tmp/{deterministic_request_id(pdf_hash, pageNumber, ocr_version)}.json"
        atomic_write_sidecar(S3_BUCKET, final_key, tmp_key, sidecar)
        
        # 4) Update Firestore manifest
        update_firestore_manifest(
            user_id=userId,
            doc_id=doc_id,
            page_number=pageNumber,
            s3_key=final_key,
            ocr_version=ocr_version,
            sidecar=sidecar,
            pdf_hash=pdf_hash,
            is_local=is_local
        )
        
        # 5) Enqueue chunker job
        enqueue_chunker_job(userId, doc_id, pageNumber, final_key, pdf_hash)
        
        return {
            "status": "ok",
            "s3Key": final_key,
            "sidecar": sidecar
        }
        
    except requests.exceptions.Timeout:
        logger.error("OCR service timeout")
        raise HTTPException(status_code=504, detail="OCR service timeout")
    except requests.exceptions.RequestException as e:
        logger.error(f"OCR service error: {e}")
        raise HTTPException(status_code=502, detail=f"OCR service error: {str(e)}")
    except Exception as e:
        logger.error(f"Processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/persist-sidecar")
async def persist_sidecar(
    userId: str = Form(...),
    docId: str = Form(...),
    pageNumber: int = Form(...),
    pdfHash: str = Form(...),
    sidecar: str = Form(...)  # JSON string
):
    """
    Direct persist endpoint - accepts pre-computed sidecar JSON
    Used when client has already run OCR locally
    """
    try:
        sidecar_obj = json.loads(sidecar)
        ocr_version = sidecar_obj.get("ocrVersion", "client-ocr")
        
        is_local = docId.startswith("local-")
        if is_local:
            final_key = make_local_sidecar_key(userId, pdfHash, pageNumber, ocr_version)
        else:
            final_key = make_sidecar_key(userId, docId, pageNumber, ocr_version)
        
        # Check existing
        existing = check_existing_sidecar(S3_BUCKET, final_key)
        if existing:
            return {"status": "exists", "s3Key": final_key}
        
        # Atomic write
        tmp_key = f"_tmp/{deterministic_request_id(pdfHash, pageNumber, ocr_version)}.json"
        atomic_write_sidecar(S3_BUCKET, final_key, tmp_key, sidecar_obj)
        
        # Update Firestore
        update_firestore_manifest(
            user_id=userId,
            doc_id=docId,
            page_number=pageNumber,
            s3_key=final_key,
            ocr_version=ocr_version,
            sidecar=sidecar_obj,
            pdf_hash=pdfHash,
            is_local=is_local
        )
        
        # Enqueue chunker
        enqueue_chunker_job(userId, docId, pageNumber, final_key, pdfHash)
        
        return {"status": "ok", "s3Key": final_key}
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid sidecar JSON")
    except Exception as e:
        logger.error(f"Persist error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sidecar/{user_id}/{doc_id}/{page_number}")
async def get_sidecar(user_id: str, doc_id: str, page_number: int):
    """Retrieve sidecar from Firestore manifest + S3"""
    try:
        manifest_ref = db.collection("users").document(user_id).collection("docs").document(doc_id)
        manifest = manifest_ref.get().to_dict()
        
        if not manifest or "sidecars" not in manifest:
            raise HTTPException(status_code=404, detail="Manifest not found")
        
        page_info = manifest["sidecars"].get(str(page_number))
        if not page_info:
            raise HTTPException(status_code=404, detail="Page sidecar not found")
        
        s3_key = page_info["s3Key"]
        sidecar = check_existing_sidecar(S3_BUCKET, s3_key)
        
        if not sidecar:
            raise HTTPException(status_code=404, detail="Sidecar file not found in S3")
        
        return {"status": "ok", "sidecar": sidecar, "s3Key": s3_key}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get sidecar error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
