
from typing import List, Dict, Any
import time

def normalize_bbox(box: List[List[int]], img_w: int, img_h: int):
    # Paddle returns 4 points: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    left = min(xs)
    top = min(ys)
    right = max(xs)
    bottom = max(ys)
    w = right - left
    h = bottom - top
    return {
      "x": left / img_w,
      "y": top / img_h,
      "w": w / img_w,
      "h": h / img_h
    }

def estimate_fontsize_norm(h: int, img_h: int):
    # simple heuristic: font height relative to page height
    return h / img_h

def paddle_to_sidecar(results: List[Any], img_w: int, img_h: int, page: int):
    tokens = []
    # results can be a list of results (if multiple images) or a single result list
    # The caller manages flattening.
    
    for res in results:
        # res format expected: (box, text, score)
        box, text, score = res
        
        bbox = normalize_bbox(box, img_w, img_h)
        
        # compute pixel height from box
        ys = [p[1] for p in box]
        height_px = max(ys) - min(ys)
        
        tokens.append({
            "text": text,
            "bbox": bbox,
            "confidence": float(score or 0.0),
            "fontSizeNorm": estimate_fontsize_norm(height_px, img_h)
        })
        
    sidecar = {
        "page": page,
        "source": "paddleocr",
        "engineVersion": "paddleocr:2.6.2",
        "width": img_w,
        "height": img_h,
        "tokens": tokens,
        "meta": {
            "processingId": str(int(time.time()*1000)),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
    }
    return sidecar
