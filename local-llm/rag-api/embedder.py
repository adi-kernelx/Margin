from sentence_transformers import SentenceTransformer
import os

class Embedder:
    _instance = None
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            print("[Embedder] Loading shared embedding model...")
            cls._instance = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
            print("[Embedder] Model loaded.")
        return cls._instance

def get_embedding(text: str):
    model = Embedder.get_instance()
    # Ensure list output for JSON serialization
    return model.encode(text).tolist()

def get_embeddings(texts: list[str]):
    model = Embedder.get_instance()
    return model.encode(texts).tolist()
