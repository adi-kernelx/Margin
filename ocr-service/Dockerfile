# Use official PaddlePaddle image (pre-installed engine)
FROM paddlepaddle/paddle:2.6.1

# Install system deps for paddleocr (cv2 headless)
# The base image is Ubuntu-based
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    git \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
    
WORKDIR /app
COPY requirements.txt .
# paddlepaddle is already installed, just install the rest
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Create app directory
COPY app /app/app

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# Run from /app so app.main is importable
# CMD assumed assuming `app` package structure
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
