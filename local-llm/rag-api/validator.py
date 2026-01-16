from sentence_transformers import util
import numpy as np
import torch
from embedder import Embedder

# We will define a simple Validator class
class Validator:
    def __init__(self):
        # reuse the same model logic as embedding service ideally
        self.model = Embedder.get_instance()

    def validate(self, question: str, answer: str, chunks: list):
        if not chunks:
            return 0.0, "No chunks to validate against"

        if "not found in the document" in answer.lower():
            return 1.0, "Model correctly declined"

        # 1. Answer vs Context Similarity
        # Embed answer lines
        
        ans_emb = self.model.encode(answer)
        
        # Max similarity against any chunk
        chunk_texts = [c["text"] for c in chunks]
        chunk_embs = self.model.encode(chunk_texts)
        
        sims = util.cos_sim(ans_emb, chunk_embs)[0]
        max_sim = float(torch.max(sims)) if 'torch' in str(type(sims)) else float(np.max(sims))
        
        return max_sim, "pass"

validator = Validator()

def validate_answer(question: str, answer: str, chunks: list):
    return validator.validate(question, answer, chunks)
