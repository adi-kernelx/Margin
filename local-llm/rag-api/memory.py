from collections import defaultdict
from typing import List, Dict

# Simple in-memory store for demonstration. 
# In production, use Redis.
class MemoryStore:
    def __init__(self):
        # sessionId -> list of turn dicts
        self.store: Dict[str, List[Dict]] = defaultdict(list)
        
    def add_turn(self, session_id: str, question: str, answer: str):
        if not session_id:
            return
        self.store[session_id].append({
            "role": "user",
            "content": question
        })
        self.store[session_id].append({
            "role": "assistant",
            "content": answer
        })
        
        # Keep window small
        if len(self.store[session_id]) > 10:
            self.store[session_id] = self.store[session_id][-10:]
            
    def get_history(self, session_id: str) -> List[Dict]:
        if not session_id:
            return []
        return self.store.get(session_id, [])

# Singleton
memory_store = MemoryStore()
