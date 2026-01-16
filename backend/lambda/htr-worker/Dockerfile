
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# In production, you would COPY your model files or download script here
# RUN python download_model.py

COPY worker.py .

CMD ["python", "worker.py"]
