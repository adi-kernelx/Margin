import os
import time
import json
import logging
import uuid
import boto3
from datetime import datetime, timezone
import traceback
from botocore.exceptions import ClientError
from io import BytesIO
from PIL import Image

# ============================================================================
# CONFIGURATION
# ============================================================================
REGION = os.environ.get("AWS_REGION", "ap-south-1")
QUEUE_URL = os.environ.get("HTR_QUEUE_URL")
BUCKET = os.environ.get("BUCKET", "pdf-reader-uploads-aditya")
EVENT_BUS = os.environ.get("EVENT_BUS_NAME")
IOU_THRESHOLD = 0.3

# Mock Model Configuration (Replace with actual model loading)
MODEL_NAME = "microsoft/trocr-base-handwritten" 

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger("htr-worker")

# AWS Clients
sqs = boto3.client("sqs", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)
events = boto3.client("events", region_name=REGION)

# ============================================================================
# MOCK HTR INFERENCE (Placeholder for Actual Model)
# ============================================================================
def load_model():
    logger.info(f"Loading HTR model: {MODEL_NAME}...")
    # In a real implementation:
    # from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    # processor = TrOCRProcessor.from_pretrained(MODEL_NAME)
    # model = VisionEncoderDecoderModel.from_pretrained(MODEL_NAME).to("cuda")
    time.sleep(2) # Simulate load
    logger.info("Model loaded.")
    return "mock_model_obj"

def predict_handwriting(image_bytes, regions):
    """
    Run inference on regions.
    regions: list of dicts {x, y, w, h} (normalized 0..1)
    Returns: list of {text, confidence} corresponding to regions
    """
    results = []
    # Real logic: crop image, preprocess, run model
    # Here we mock it
    for r in regions:
        # Simulate varying confidence
        results.append({
            "text": "[Handwritten Text]", 
            "confidence": 0.85
        })
    return results

# ============================================================================
# UTILITIES
# ============================================================================
def compute_iou(boxA, boxB):
    # box: {x, y, w, h} normalized
    xA = max(boxA["x"], boxB["x"])
    yA = max(boxA["y"], boxB["y"])
    xB = min(boxA["x"] + boxA["w"], boxB["x"] + boxB["w"])
    yB = min(boxA["y"] + boxA["h"], boxB["y"] + boxB["h"])

    interWidth = max(0, xB - xA)
    interHeight = max(0, yB - yA)
    interArea = interWidth * interHeight

    boxAArea = boxA["w"] * boxA["h"]
    boxBArea = boxB["w"] * boxB["h"]

    iou = interArea / float(boxAArea + boxBArea - interArea + 1e-6)
    return iou

def merge_htr_results(sidecar, htr_tokens):
    """
    Merge HTR results into existing sidecar tokens based on IoU.
    """
    tokens = sidecar.get("tokens", [])
    
    for h in htr_tokens:
        h_bbox = h["bbox"]
        best_iou = 0
        best_idx = -1
        
        # Find overlapping print token
        for idx, t in enumerate(tokens):
            iou = compute_iou(h_bbox, t["bbox"])
            if iou > best_iou:
                best_iou = iou
                best_idx = idx
        
        if best_iou > IOU_THRESHOLD:
            # Overlap found - check confidence
            original = tokens[best_idx]
            if h["confidence"] > original.get("confidence", 0):
                logger.info(f"Replacing token {original['text']} with HTR {h['text']} (IoU={best_iou:.2f})")
                tokens[best_idx].update({
                    "text": h["text"],
                    "confidence": h["confidence"],
                    "sourceType": "handwriting",
                    "origin": "htr",
                    "originalText": original.get("text") # Audit trail
                })
        else:
            # New token (no overlap)
            new_id = f"htr-{uuid.uuid4().hex[:8]}"
            tokens.append({
                "id": new_id,
                "text": h["text"],
                "bbox": h_bbox,
                "confidence": h["confidence"],
                "tokenIndex": len(tokens),
                "lineId": None, # todo: reconstruct lines
                "sourceType": "handwriting",
                "origin": "htr"
            })
            
    sidecar["tokens"] = tokens
    sidecar["summary"]["tokensCount"] = len(tokens)
    return sidecar

def process_message(msg_body, model):
    request_id = msg_body.get("requestId")
    doc_id = msg_body.get("docId")
    page = msg_body.get("page")
    page_key = msg_body.get("pageKey")
    sidecar_key = msg_body.get("sidecarKey")
    force = msg_body.get("force", False)

    logger.info(f"Processing HTR: {doc_id} p{page} (req={request_id})")

    # 1. Idempotency Check
    try:
        r = s3.get_object(Bucket=BUCKET, Key=sidecar_key)
        existing_sidecar = json.loads(r["Body"].read())
        
        if not force and existing_sidecar.get("processing", {}).get("htrCompleted"):
             logger.info("HTR already completed. Skipping.")
             return
    except ClientError as e:
        logger.error(f"Failed to read sidecar: {e}")
        raise # Retry

    # 2. Identify Handwriting Regions
    # (In real implementation: use layout model or select low-conf tokens)
    # Here we mock selecting all tokens with low confidence
    target_tokens = [t for t in existing_sidecar.get("tokens", []) if t.get("confidence", 1.0) < 0.8]
    if not target_tokens:
        logger.info("No low confidence tokens found. Marking HTR complete.")
        # Mark complete anyway
    else:
        # Mock Inference
        logger.info(f"Running HTR on {len(target_tokens)} candidate regions...")
        
        # 3. Predict (Mock)
        htr_candidates = []
        for t in target_tokens:
            htr_candidates.append({
                "bbox": t["bbox"],
                "text": "[HTR]", # Mock result
                "confidence": 0.90
            })
            
        # 4. Merge
        updated_sidecar = merge_htr_results(existing_sidecar, htr_candidates)
        
        # 5. Update Metadata
        updated_sidecar["processing"]["htrCompleted"] = True
        updated_sidecar["processing"]["htrCompletedAt"] = datetime.now(timezone.utc).isoformat()
        updated_sidecar["processing"]["htrWorkerId"] = "ecs-worker-1"
        updated_sidecar["ocr"]["pages"][str(page)]["htrStatus"] = "completed" # Manifest update logic needed? No, purely sidecar here?
        # Actually standard flow says update manifest too.

        # 6. Atomic Write
        out_bytes = json.dumps(updated_sidecar).encode("utf-8")
        tmp_key = sidecar_key.replace(".json", f".tmp.{request_id}")
        
        s3.put_object(Bucket=BUCKET, Key=tmp_key, Body=out_bytes)
        s3.copy_object(Bucket=BUCKET, Key=sidecar_key, CopySource={"Bucket": BUCKET, "Key": tmp_key})
        s3.delete_object(Bucket=BUCKET, Key=tmp_key)
        
        # 7. Update Manifest (simplified)
        try:
            manifest_key = f"users/{msg_body['userId']}/docs/{doc_id}/manifest.json"
            r = s3.get_object(Bucket=BUCKET, Key=manifest_key)
            manifest = json.loads(r["Body"].read())
            if "ocr" in manifest and "pages" in manifest["ocr"]:
                if str(page) in manifest["ocr"]["pages"]:
                     manifest["ocr"]["pages"][str(page)]["htrStatus"] = "completed"
                     s3.put_object(Bucket=BUCKET, Key=manifest_key, Body=json.dumps(manifest))
        except Exception as e:
            logger.warning(f"Manifest update failed: {e}")

        logger.info("HTR Complete and saved.")

        # 8. Emit Event
        if EVENT_BUS:
            events.put_events(Entries=[{
                "Source": "app.htr",
                "DetailType": "htr-complete",
                "Detail": json.dumps({
                    "docId": doc_id,
                    "page": page,
                    "sidecarKey": sidecar_key
                }),
                "EventBusName": EVENT_BUS
            }])

# ============================================================================
# MAIN LOOP
# ============================================================================
def main():
    if not QUEUE_URL:
        logger.error("HTR_QUEUE_URL not set.")
        return

    model = load_model()
    logger.info(f"Worker started. Polling {QUEUE_URL}...")

    while True:
        try:
            resp = sqs.receive_message(
                QueueUrl=QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20
            )

            if "Messages" in resp:
                for msg in resp["Messages"]:
                    try:
                        body = json.loads(msg["Body"])
                        process_message(body, model)
                        
                        # Delete successful message
                        sqs.delete_message(
                            QueueUrl=QUEUE_URL,
                            ReceiptHandle=msg["ReceiptHandle"]
                        )
                    except Exception as e:
                        logger.error(f"Processing failed: {e}")
                        traceback.print_exc()
                        # Do NOT delete, let visibility timeout expire
        except Exception as e:
            logger.error(f"Polling loop error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
