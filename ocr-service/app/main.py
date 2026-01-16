
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .ocr_service import run_paddle_on_image_bytes
import uvicorn

app = FastAPI(title="PaddleOCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local dev, allow all. usage specific origins in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/ocr/recognize")
async def recognize(file: UploadFile = File(...), page: int = Query(1)):
    try:
        content = await file.read()
        sidecar = run_paddle_on_image_bytes(content, page=page)
        return JSONResponse(sidecar)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
