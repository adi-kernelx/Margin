import time

class PerformanceMonitor:
    def __init__(self):
        self.metrics = {
            "retrieval_ms": 0,
            "rerank_ms": 0,
            "llm_ms": 0,
            "validation_ms": 0,
            "total_ms": 0
        }
        self.start_times = {}

    def start(self, key):
        self.start_times[key] = time.time()

    def stop(self, key):
        if key in self.start_times:
            elapsed = (time.time() - self.start_times[key]) * 1000
            self.metrics[f"{key}_ms"] = int(elapsed)
            del self.start_times[key]

    def get_metrics(self):
        return self.metrics

# Context manager support
class Measure:
    def __init__(self, monitor, key):
        self.monitor = monitor
        self.key = key
    
    def __enter__(self):
        self.monitor.start(self.key)
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.monitor.stop(self.key)
