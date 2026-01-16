# file: lambda_handler.py
# OCR Page Worker Lambda - Google Cloud Vision Integration
#
# Consumes SQS messages, calls Cloud Vision DOCUMENT_TEXT_DETECTION,
# produces canonical ocr/page-XXXX.json sidecars with atomic writes.
#
# Dependencies: google-cloud-vision, google-auth, Pillow, boto3
# Packaging: Use Lambda container image or layers

import os
import json
import logging
import uuid
import time
import traceback
from datetime import datetime, timezone
from io import BytesIO

import boto3
from botocore.exceptions import ClientError

# Google Vision libs
from google.oauth2 import service_account
from google.cloud import vision

from PIL import Image

# ============================================================================
# CONFIGURATION (from Lambda environment variables)
# ============================================================================
BUCKET = os.environ.get("BUCKET", "pdf-reader-uploads-aditya")
GC_SECRET_NAME = os.environ.get("GC_SECRET_NAME", "gc-vision-sa-prod")
EVENT_BUS = os.environ.get("EVENT_BUS_NAME")  # Optional: EventBridge bus name
HANDWRITING_THRESHOLD = float(os.environ.get("HANDWRITING_CONF_THRESHOLD", "0.72"))

# AWS Clients
s3 = boto3.client("s3")
secrets = boto3.client("secretsmanager")
events = boto3.client("events")

# Logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Cache for GCP credentials (reuse across invocations)
_vision_client = None


# ============================================================================
# GCP CREDENTIALS & VISION CLIENT
# ============================================================================
def get_gcp_credentials_from_secret(secret_name):
    """Read GCP service-account JSON from Secrets Manager."""
    if not secret_name:
        raise RuntimeError("GC_SECRET_NAME is not set in environment")
    try:
        res = secrets.get_secret_value(SecretId=secret_name)
        secret = res.get("SecretString") or res.get("SecretBinary").decode("utf-8")
        info = json.loads(secret)
        creds = service_account.Credentials.from_service_account_info(info)
        return creds
    except Exception as e:
        logger.error("Failed to load GCP secret: %s", e)
        raise


def get_vision_client():
    """Get or create cached Vision client."""
    global _vision_client
    if _vision_client is None:
        creds = get_gcp_credentials_from_secret(GC_SECRET_NAME)
        _vision_client = vision.ImageAnnotatorClient(credentials=creds)
        logger.info("Vision client initialized from Secrets Manager")
    return _vision_client


# ============================================================================
# BBOX NORMALIZATION
# ============================================================================
def normalize_bbox(vertices, width, height):
    """Convert Vision vertices to normalized bbox {x, y, w, h} in [0..1]."""
    if not vertices or width <= 0 or height <= 0:
        return {"x": 0, "y": 0, "w": 0, "h": 0}
    
    xs = [v.x for v in vertices]
    ys = [v.y for v in vertices]
    minx = min(xs)
    miny = min(ys)
    maxx = max(xs)
    maxy = max(ys)
    
    return {
        "x": minx / width,
        "y": miny / height,
        "w": (maxx - minx) / width,
        "h": (maxy - miny) / height
    }


# ============================================================================
# VISION RESPONSE PARSING
# ============================================================================
def parse_vision_response(response, image_width, image_height):
    """
    Parse Google Vision DocumentTextAnnotation into tokens and lines.
    Returns (tokens_list, lines_list, avg_confidence).
    """
    tokens = []
    lines = []
    token_idx = 0
    
    fta = response.full_text_annotation
    if not fta or not fta.pages:
        logger.warning("No text detected in image")
        return [], [], 0.0

    for p_idx, page in enumerate(fta.pages):
        for b_idx, block in enumerate(page.blocks):
            for para_idx, para in enumerate(block.paragraphs):
                line_id = f"l-{p_idx:02d}-{b_idx:02d}-{para_idx:02d}"
                line_text_parts = []
                word_bboxes = []
                word_confs = []
                line_token_ids = []

                for w in para.words:
                    # Word text is concatenation of symbols
                    word_text = "".join([s.text for s in w.symbols])
                    
                    # Calculate word confidence from symbols
                    sym_confs = [s.confidence for s in w.symbols if hasattr(s, "confidence") and s.confidence]
                    word_conf = sum(sym_confs) / len(sym_confs) if sym_confs else 0.9

                    # Bounding box
                    bbox = normalize_bbox(w.bounding_box.vertices, image_width, image_height)

                    token_id = f"t-{token_idx:06d}"
                    tokens.append({
                        "id": token_id,
                        "text": word_text,
                        "bbox": bbox,
                        "confidence": round(float(word_conf), 4),
                        "tokenIndex": token_idx,
                        "lineId": line_id,
                        "sourceType": "print"
                    })
                    
                    line_token_ids.append(token_id)
                    token_idx += 1
                    line_text_parts.append(word_text)
                    word_bboxes.append(bbox)
                    word_confs.append(float(word_conf))

                # Compute line bounding box (union of word bboxes)
                if word_bboxes:
                    minx = min(b["x"] for b in word_bboxes)
                    miny = min(b["y"] for b in word_bboxes)
                    maxr = max(b["x"] + b["w"] for b in word_bboxes)
                    maxb = max(b["y"] + b["h"] for b in word_bboxes)
                    line_bbox = {"x": minx, "y": miny, "w": maxr - minx, "h": maxb - miny}
                else:
                    line_bbox = {"x": 0, "y": 0, "w": 0, "h": 0}

                line_text = " ".join(line_text_parts).strip()
                line_conf = sum(word_confs) / len(word_confs) if word_confs else 0.0
                
                lines.append({
                    "id": line_id,
                    "text": line_text,
                    "bbox": line_bbox,
                    "confidence": round(float(line_conf), 4),
                    "tokenIds": line_token_ids
                })

    # Average token confidence
    avg_conf = sum(t["confidence"] for t in tokens) / len(tokens) if tokens else 0.0
    return tokens, lines, round(avg_conf, 4)


# ============================================================================
# HANDWRITING DETECTION HEURISTICS
# ============================================================================
def compute_handwriting_score(tokens, avg_conf):
    """
    Simple heuristic for handwriting detection.
    Returns (handwriting_detected: bool, handwriting_confidence: float).
    """
    if not tokens:
        return False, 0.0

    # Small common word dictionary for speed
    common_words = {
        "the", "and", "is", "in", "to", "for", "of", "a", "an", "with", 
        "on", "that", "this", "it", "be", "are", "was", "have", "has",
        "from", "at", "by", "or", "as", "not", "but", "what", "all"
    }
    
    token_texts = [t["text"].lower().strip() for t in tokens]
    
    # Calculate ratios
    non_alpha_ratio = sum(1 for t in token_texts if not t.isalpha()) / max(1, len(token_texts))
    non_dict_ratio = sum(1 for t in token_texts if t not in common_words) / max(1, len(token_texts))
    
    # Confidence-based score (lower avg_conf -> higher handwriting likelihood)
    conf_score = max(0.0, min(1.0, 1.0 - avg_conf))
    
    # Combined score
    score = 0.6 * conf_score + 0.2 * non_alpha_ratio + 0.2 * non_dict_ratio
    
    # Threshold check
    handwriting_detected = avg_conf < HANDWRITING_THRESHOLD
    handwriting_confidence = round(min(1.0, max(0.0, score)), 4)
    
    return handwriting_detected, handwriting_confidence


# ============================================================================
# ATOMIC S3 WRITE
# ============================================================================
def write_sidecar_atomic(bucket, tmp_key, final_key, payload_bytes):
    """Write to temp key, copy to final key (atomic), delete temp."""
    try:
        # Step 1: Write to temp location
        s3.put_object(
            Bucket=bucket, 
            Key=tmp_key, 
            Body=payload_bytes, 
            ContentType="application/json"
        )
        
        # Step 2: Copy to final location (atomic overwrite)
        s3.copy_object(
            Bucket=bucket, 
            Key=final_key, 
            CopySource={"Bucket": bucket, "Key": tmp_key}
        )
        
        # Step 3: Delete temp
        s3.delete_object(Bucket=bucket, Key=tmp_key)
        
        logger.info("Wrote sidecar atomically: %s", final_key)
    except Exception as e:
        # Try to clean up temp file on failure
        try:
            s3.delete_object(Bucket=bucket, Key=tmp_key)
        except:
            pass
        raise


# ============================================================================
# MANIFEST UPDATE
# ============================================================================
def update_manifest(bucket, manifest_key, page, avg_confidence, handwriting_detected):
    """Read manifest.json, patch ocr.pages[page], write back."""
    manifest = {}
    
    # Read existing manifest
    try:
        r = s3.get_object(Bucket=bucket, Key=manifest_key)
        manifest = json.loads(r["Body"].read())
    except ClientError as e:
        if e.response["Error"]["Code"] not in ("NoSuchKey", "404"):
            logger.warning("Error reading manifest: %s", e)
    
    # Initialize OCR section if needed
    if "ocr" not in manifest:
        manifest["ocr"] = {"pages": {}, "lastUpdated": None}
    if "pages" not in manifest["ocr"]:
        manifest["ocr"]["pages"] = {}
    
    # Update page status
    manifest["ocr"]["pages"][str(page)] = {
        "status": "completed",
        "avgConfidence": avg_confidence,
        "handwritingDetected": handwriting_detected,
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }
    manifest["ocr"]["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
    
    # Write back
    s3.put_object(
        Bucket=bucket, 
        Key=manifest_key, 
        Body=json.dumps(manifest, indent=2).encode("utf-8"), 
        ContentType="application/json"
    )
    logger.info("Updated manifest: %s", manifest_key)


# ============================================================================
# EVENT PUBLISHING (Optional)
# ============================================================================
def publish_event(detail):
    """Publish ocr-complete event to EventBridge (if configured)."""
    if not EVENT_BUS:
        return
    
    try:
        events.put_events(Entries=[{
            "Source": "app.ocr",
            "DetailType": "ocr-complete",
            "Detail": json.dumps(detail),
            "EventBusName": EVENT_BUS
        }])
        logger.info("Published ocr-complete event")
    except Exception as e:
        logger.warning("Failed to publish event: %s", e)


# ============================================================================
# MAIN HANDLER
# ============================================================================
def handler(event, context):
    """
    Lambda handler for SQS OCR page jobs.
    Processes messages, calls Vision API, writes sidecars.
    """
    logger.info("Received %d records", len(event.get("Records", [])))
    
    vision_client = get_vision_client()
    
    for rec in event.get("Records", []):
        message_id = rec.get("messageId", "unknown")
        body = json.loads(rec["body"])
        request_id = body.get("requestId", str(uuid.uuid4()))
        
        try:
            # Validate job type
            if body.get("jobType") != "OCR_PAGE":
                logger.error("Unsupported jobType: %s (msgId=%s)", body.get("jobType"), message_id)
                continue

            # Extract job parameters
            userId = body["userId"]
            docId = body["docId"]
            page = int(body["page"])
            pageKey = body["pageKey"]
            force = bool(body.get("force", False))

            logger.info("Processing: docId=%s, page=%d, requestId=%s", docId, page, request_id)

            # Compute S3 keys
            final_sidecar_key = f"users/{userId}/docs/{docId}/ocr/page-{page:04d}.json"
            tmp_key = f"users/{userId}/docs/{docId}/ocr/_tmp/{request_id}.json"
            manifest_key = f"users/{userId}/docs/{docId}/manifest.json"

            # Idempotency check
            try:
                s3.head_object(Bucket=BUCKET, Key=final_sidecar_key)
                if not force:
                    logger.info("Sidecar exists, skipping: %s", final_sidecar_key)
                    continue
                logger.info("Force=True, will overwrite: %s", final_sidecar_key)
            except ClientError as e:
                if e.response["Error"]["Code"] not in ("404", "NoSuchKey"):
                    raise

            # Download page image
            logger.info("Downloading: %s", pageKey)
            obj = s3.get_object(Bucket=BUCKET, Key=pageKey)
            img_bytes = obj["Body"].read()

            # Get image dimensions
            image = Image.open(BytesIO(img_bytes))
            width, height = image.size
            logger.info("Image size: %dx%d", width, height)

            # Call Cloud Vision
            logger.info("Calling Vision API...")
            started_at = datetime.now(timezone.utc).isoformat()
            
            gimage = vision.Image(content=img_bytes)
            response = vision_client.document_text_detection(image=gimage)
            
            if response.error.message:
                raise RuntimeError(f"Vision API error: {response.error.message}")

            completed_at = datetime.now(timezone.utc).isoformat()

            # Parse response
            tokens, lines, avg_conf = parse_vision_response(response, width, height)
            logger.info("Parsed: %d tokens, %d lines, avg_conf=%.4f", len(tokens), len(lines), avg_conf)

            # Handwriting detection
            handwriting_detected, handwriting_confidence = compute_handwriting_score(tokens, avg_conf)
            if handwriting_detected:
                logger.info("Handwriting detected (confidence=%.4f)", handwriting_confidence)

            # Build canonical sidecar
            sidecar = {
                "docId": docId,
                "page": page,
                "sourceImageKey": pageKey,
                "source": "gcv-vision",
                "processing": {
                    "startedAt": started_at,
                    "completedAt": completed_at,
                    "status": "success",
                    "workerId": context.aws_request_id if context else "lambda",
                    "version": 1
                },
                "summary": {
                    "avgConfidence": avg_conf,
                    "handwritingDetected": handwriting_detected,
                    "handwritingConfidence": handwriting_confidence,
                    "tokensCount": len(tokens)
                },
                "lines": lines,
                "tokens": tokens
            }

            # Atomic write
            payload_bytes = json.dumps(sidecar, indent=2).encode("utf-8")
            write_sidecar_atomic(BUCKET, tmp_key, final_sidecar_key, payload_bytes)

            # Update manifest
            update_manifest(BUCKET, manifest_key, page, avg_conf, handwriting_detected)

            # Publish event
            publish_event({
                "docId": docId,
                "userId": userId,
                "page": page,
                "sidecarKey": final_sidecar_key,
                "avgConfidence": avg_conf,
                "handwritingDetected": handwriting_detected,
                "requestId": request_id
            })

            logger.info("SUCCESS: %s page %d -> %s", docId, page, final_sidecar_key)

        except Exception as exc:
            logger.exception("FAILED processing msgId=%s, requestId=%s: %s", message_id, request_id, exc)
            # Re-raise to let SQS retry
            raise

    return {"statusCode": 200, "processed": len(event.get("Records", []))}
