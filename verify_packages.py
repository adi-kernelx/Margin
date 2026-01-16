
try:
    import boto3
    import requests
    import qdrant_client
    import typesense
    print("SUCCESS: All required packages (boto3, requests, qdrant-client, typesense) are installed.")
except ImportError as e:
    print(f"ERROR: Missing package: {e.name}")
    exit(1)
