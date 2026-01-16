
from paddleocr import PaddleOCR
from PIL import Image
import io
import numpy as np
from .parse_paddle import paddle_to_sidecar
import logging

# Setup logger
logger = logging.getLogger("ocr_service")

# Instantiate global OCR models
# This might take time to download models on first run
# Using multiple language models for multilingual support
logging.info("Loading PaddleOCR models (multilingual)...")

# Primary: Latin/English - covers English, Spanish, French, German, etc.
ocr_latin = PaddleOCR(
    use_angle_cls=True,
    lang='latin',        # Broader Latin script support
    use_gpu=False,
    show_log=False
)

# Secondary: Devanagari/Hindi - covers Hindi, Sanskrit, Marathi, etc.
ocr_devanagari = PaddleOCR(
    use_angle_cls=True,
    lang='devanagari',   # Hindi/Devanagari script
    use_gpu=False,
    show_log=False
)

logging.info("PaddleOCR models loaded (Latin + Devanagari).")

def run_paddle_on_image_bytes(image_bytes: bytes, page:int=1):
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_w, img_h = img.size
    img_array = np.array(img)
    
    # Run OCR with Latin model first
    result_latin = ocr_latin.ocr(img_array, cls=True)
    
    # Run OCR with Devanagari model
    result_devanagari = ocr_devanagari.ocr(img_array, cls=True)
    
    # Merge results from both models
    flat = []
    
    # Process Latin results
    if result_latin and result_latin[0]:
        for line in result_latin[0]:
            box = line[0]
            text_score = line[1]
            text = text_score[0]
            score = text_score[1]
            flat.append((box, text, score))
    
    # Process Devanagari results - add only if non-overlapping or better confidence
    if result_devanagari and result_devanagari[0]:
        for line in result_devanagari[0]:
            box = line[0]
            text_score = line[1]
            text = text_score[0]
            score = text_score[1]
            
            # Check if this is a new detection (not overlapping with Latin results)
            # Simple heuristic: check if any Latin result has similar position
            is_new = True
            for existing_box, existing_text, existing_score in flat:
                if _boxes_overlap(box, existing_box):
                    # If Devanagari has higher confidence and looks like Hindi, replace
                    if score > existing_score and _looks_like_devanagari(text):
                        flat.remove((existing_box, existing_text, existing_score))
                        flat.append((box, text, score))
                    is_new = False
                    break
            
            if is_new:
                flat.append((box, text, score))
            
    sidecar = paddle_to_sidecar(flat, img_w, img_h, page)
    return sidecar

def _boxes_overlap(box1, box2, threshold=0.5):
    """Check if two bounding boxes overlap significantly."""
    xs1 = [p[0] for p in box1]
    ys1 = [p[1] for p in box1]
    xs2 = [p[0] for p in box2]
    ys2 = [p[1] for p in box2]
    
    x1_min, x1_max = min(xs1), max(xs1)
    y1_min, y1_max = min(ys1), max(ys1)
    x2_min, x2_max = min(xs2), max(xs2)
    y2_min, y2_max = min(ys2), max(ys2)
    
    # Calculate intersection
    ix_min = max(x1_min, x2_min)
    iy_min = max(y1_min, y2_min)
    ix_max = min(x1_max, x2_max)
    iy_max = min(y1_max, y2_max)
    
    if ix_max < ix_min or iy_max < iy_min:
        return False
    
    intersection = (ix_max - ix_min) * (iy_max - iy_min)
    area1 = (x1_max - x1_min) * (y1_max - y1_min)
    area2 = (x2_max - x2_min) * (y2_max - y2_min)
    min_area = min(area1, area2)
    
    if min_area == 0:
        return False
    
    return (intersection / min_area) > threshold

def _looks_like_devanagari(text):
    """Check if text contains Devanagari characters."""
    devanagari_range = range(0x0900, 0x097F + 1)  # Unicode range for Devanagari
    devanagari_count = sum(1 for c in text if ord(c) in devanagari_range)
    return devanagari_count > len(text) * 0.3  # More than 30% Devanagari chars

