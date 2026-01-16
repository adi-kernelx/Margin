FROM public.ecr.aws/docker/library/python:3.10-slim

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python deps
RUN pip install --upgrade pip
RUN pip install fastapi uvicorn boto3 google-cloud-firestore requests

# Copy app
COPY orchestrator.py /app/orchestrator.py

EXPOSE 8080

CMD ["uvicorn", "orchestrator:app", "--host", "0.0.0.0", "--port", "8080"]
