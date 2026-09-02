from typing import TypedDict, List
from langgraph.graph import StateGraph, END
from schemas import Source, QueryRequest, QueryScope
from retriever import retrieve
from reranker import rerank
from prompt import build_prompt
from llm_client import generate as llm_generate
from validator import validate_answer
from memory import memory_store
from monitor import PerformanceMonitor, Measure
from cache import cache_store
import json
import hashlib

class GraphState(TypedDict):
    question: str
    mode: str
    scope: QueryScope
    sessionId: str
    topK: int
    chunks: List[dict]
    answer: str
    confidence: float
    metrics: dict
    monitor: PerformanceMonitor

def router_step(state: GraphState):
    if state["mode"] == "explain":
        return "generate"
    return "retrieve"

def retrieve_step(state: GraphState):
    monitor = state["monitor"]
    with Measure(monitor, "retrieval"):
        # Cache Check
        scope_str = str(state["scope"].dict()) if state["scope"] else ""
        cached = cache_store.get_retrieval(state["question"], state["mode"], scope_str)
        if cached:
            print("[Cache] Retrieval hit")
            return {"chunks": cached}
            
        fetch_k = state["topK"] * 3
        chunks = retrieve(state["question"], fetch_k, state["scope"])
        
        # Cache Set
        cache_store.set_retrieval(state["question"], state["mode"], scope_str, chunks)
        
    return {"chunks": chunks}

def rerank_step(state: GraphState):
    if not state["chunks"]:
        return {"chunks": []}
    
    monitor = state["monitor"]
    with Measure(monitor, "rerank"):
        ranked = rerank(state["question"], state["chunks"], state["topK"])
    return {"chunks": ranked}

def generate_step(state: GraphState):
    monitor = state["monitor"]
    
    # 1. Explain Mode
    if state["mode"] == "explain":
        with Measure(monitor, "llm"):
            prompt_text = build_prompt(state["question"], [], mode="explain")
            answer = llm_generate(prompt_text)
        return {
            "answer": answer,
            "confidence": 1.0, 
            "metrics": {"note": "Explanation mode"}
        }

    # 2. Build prompt (handles empty chunks gracefully with new prompt.py)
    prompt_text = build_prompt(state["question"], state["chunks"], mode=state["mode"])
    
    # 3. Check if we have meaningful context
    has_context = bool(state["chunks"]) and len(state["chunks"]) > 0
    
    if not has_context:
        print("[Graph] No chunks found, using general response mode")
    
    prompt_hash = hashlib.sha256(prompt_text.encode()).hexdigest()
    
    # Cache Check (Answer)
    cached_ans = cache_store.get_answer(prompt_hash)
    if cached_ans:
        print("[Cache] Answer hit")
        return cached_ans

    # 4. Generate LLM Response
    with Measure(monitor, "llm"):
        raw_response = llm_generate(prompt_text)
    
    # Answer is now plain text (no JSON parsing needed)
    answer = raw_response.strip()
    g_score = 0.0
    note = "n/a"
    
    if state["mode"] == "qa" and has_context:
        with Measure(monitor, "validation"):
            g_score, note = validate_answer(state["question"], answer, state["chunks"])

    if state["sessionId"]:
        memory_store.add_turn(state["sessionId"], state["question"], answer)

    avg_relevance = 0
    if state["chunks"]:
        avg_relevance = sum([c.get("relevance_score", 0) for c in state["chunks"]]) / len(state["chunks"])
    
    # Confidence: lower if no context
    if has_context:
        conf = (0.5 * g_score) + (0.5 * min(max((avg_relevance + 5) / 10, 0), 1))
    else:
        conf = 0.3  # Lower confidence for general responses
    
    result = {
        "answer": answer,
        "confidence": round(conf, 2),
        "metrics": {
            "grounding_score": round(g_score, 2),
            "avg_relevance": round(avg_relevance, 2),
            "validation_note": note,
            "mode": "grounded" if has_context else "general"
        }
    }
    
    # Cache Set
    cache_store.set_answer(prompt_hash, result)
    
    return result

workflow = StateGraph(GraphState)
workflow.add_node("retrieve", retrieve_step)
workflow.add_node("rerank", rerank_step)
workflow.add_node("generate", generate_step)

workflow.set_conditional_entry_point(
    router_step,
    {
        "retrieve": "retrieve",
        "generate": "generate"
    }
)

workflow.add_edge("retrieve", "rerank")
workflow.add_edge("rerank", "generate")
workflow.add_edge("generate", END)

app_graph = workflow.compile()

async def run_graph(req: QueryRequest):
    monitor = PerformanceMonitor()
    monitor.start("total")
    
    inputs = {
        "question": req.question,
        "mode": req.mode,
        "scope": req.scope,
        "sessionId": req.sessionId,
        "topK": req.topK,
        "chunks": [],
        "answer": "",
        "confidence": 0.0,
        "metrics": {},
        "monitor": monitor
    }
    
    result = await app_graph.ainvoke(inputs)
    
    monitor.stop("total")
    perf_metrics = monitor.get_metrics()
    
    # Merge metrics
    final_metrics = result.get("metrics", {})
    final_metrics.update(perf_metrics)
    
    # Map sources
    sources = [Source(**c) for c in result.get("chunks", [])]
    
    return {
        "answer": result["answer"],
        "confidence": result["confidence"],
        "sources": sources,
        "metrics": final_metrics
    }
