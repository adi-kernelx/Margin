"""POST /bundle: build an Open Knowledge Format bundle for one PDF.

The bundle code lives in the repo's ml/ package (ml/okf/). It needs the PDF
bytes rather than extracted text, because block extraction reads fonts and
layout. MARGIN_ML_ROOT is the directory that contains ml/; in Docker the
compose file mounts it read-only at /margin.
"""

import os
import sys
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from typing import Dict, List

ML_ROOT = Path(os.getenv("MARGIN_ML_ROOT", Path(__file__).resolve().parents[2]))
ARTIFACT = ML_ROOT / "ml/models/artifacts/okf_pipeline.joblib"
MAX_BYTES = 200 * 1024 * 1024
CATEGORIES = {"paper", "textbook", "slides", "notes", "thesis", "standard", "assignment", "solutions"}

router = APIRouter()
_pipeline = None
_lock = threading.Lock()


class BundleFile(BaseModel):
    path: str
    content: str


class BundleResponse(BaseModel):
    fingerprint: str
    fileName: str
    summary: Dict
    files: List[BundleFile]
    # the concepts as plain data (title, type, page, bbox, links), so clients need not parse YAML
    concepts: List[Dict]


def get_pipeline():
    """Load the frozen pipeline once; 503 when the ml package or its artifact is absent."""
    global _pipeline
    with _lock:
        if _pipeline is None:
            if not ARTIFACT.exists():
                raise HTTPException(503, f"Bundle model not found at {ARTIFACT}; run python -m ml.okf.pipeline")
            if str(ML_ROOT) not in sys.path:
                sys.path.insert(0, str(ML_ROOT))
            from ml.okf.pipeline import FrozenPipeline
            _pipeline = FrozenPipeline.load(ARTIFACT)
        return _pipeline


@router.post("/bundle", response_model=BundleResponse)
def bundle_endpoint(file: UploadFile = File(...), category: str = Form("paper")):
    if category not in CATEGORIES:
        raise HTTPException(422, f"category must be one of {sorted(CATEGORIES)}")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "PDF is larger than 200 MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Not a PDF")
    pipeline = get_pipeline()
    from ml.okf.bundle import bundle_files
    name = Path(file.filename or "document.pdf").name
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "document.pdf"
        path.write_bytes(data)
        files, summary, records = bundle_files(path, pipeline, category, file_name=name)
    return BundleResponse(fingerprint=summary["fingerprint"], fileName=name, summary=summary,
                          files=[BundleFile(path=p, content=c) for p, c in sorted(files.items())],
                          concepts=records)
