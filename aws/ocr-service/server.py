from fastapi import FastAPI, UploadFile, File, Form
from paddleocr import PaddleOCR
import numpy as np
import cv2
import time
import hashlib

app = FastAPI()
ocr = PaddleOCR(use_angle_cls=True, lang='en')

SIDE_CAR_VERSION = 1
OCR_VERSION = "paddleocr-2.7.0.2-cpu-v1"

@app.get("/health")
def health():
    return {"status": "ok"}

def normalize_bbox(box, width, height):
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return [min(xs) / width, min(ys) / height, max(xs) / width, max(ys) / height]

def make_token_id(text, bbox):
    key = f"{text}:{bbox}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]

@app.post("/ocr")
async def run_ocr(file: UploadFile = File(...), docId: str = Form(None), pageNumber: int = Form(None), pdfHash: str = Form(None)):
    start = time.time()
    data = await file.read()
    img_array = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    height, width = img.shape[:2]
    
    # Updated API - removed cls=True
    raw = ocr.ocr(img)
    
    tokens = []
    token_index = 0
    
    # Handle new API response format
    if raw and len(raw) > 0:
        for page_result in raw:
            if not page_result:
                continue
            for item in page_result:
                if not item or len(item) < 2:
                    continue
                box = item[0]
                text_info = item[1]
                if isinstance(text_info, tuple) and len(text_info) >= 2:
                    text, conf = text_info[0], text_info[1]
                else:
                    continue
                bbox = normalize_bbox(box, width, height)
                token = {"id": token_index, "stableId": make_token_id(text, bbox), "text": text, "confidence": float(conf), "bbox": bbox}
                tokens.append(token)
                token_index += 1
    
    tokens.sort(key=lambda t: (t["bbox"][1], t["bbox"][0]))
    
    lines = []
    current = []
    threshold = 0.015
    for t in tokens:
        if not current:
            current = [t]
            continue
        if abs(t["bbox"][1] - current[0]["bbox"][1]) < threshold:
            current.append(t)
        else:
            lines.append(current)
            current = [t]
    if current:
        lines.append(current)
    
    line_objects = []
    for i, group in enumerate(lines):
        x0 = min(t["bbox"][0] for t in group)
        y0 = min(t["bbox"][1] for t in group)
        x1 = max(t["bbox"][2] for t in group)
        y1 = max(t["bbox"][3] for t in group)
        line_objects.append({"id": i, "text": " ".join(t["text"] for t in group), "tokens": [t["id"] for t in group], "bbox": [x0, y0, x1, y1]})
    
    duration = int((time.time() - start) * 1000)
    response = {
        "sidecarVersion": SIDE_CAR_VERSION, 
        "ocrVersion": OCR_VERSION, 
        "docId": docId, 
        "pageNumber": pageNumber, 
        "pdfHash": pdfHash, 
        "imageMeta": {"width": width, "height": height, "dpr": 1}, 
        "processing": {"engine": "paddleocr", "durationMs": duration}, 
        "summary": {"tokenCount": len(tokens), "avgConfidence": round(sum(t["confidence"] for t in tokens) / max(len(tokens), 1), 4)}, 
        "tokens": tokens, 
        "lines": line_objects
    }
    return response
