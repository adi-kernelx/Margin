import os
import time
from typing import TypedDict, List, Literal
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.http import models
from .types import QueryRequest, Source, QueryResponse

# Environment
QDRANT_URL = os.getenv("QDRANT_URL", "http://host.docker.internal:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://llm-runtime:8081/v1")
COLLECTION_NAME = "pdf_chunks" # Ensuring this matches ingest pipeline

# Models
# We load the embedding model globally so it stays in memory
# sentence-transformers/all-MiniLM-L6-v2 matches the one used in ingest
print("Loading embedding model...")
embed_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
print("Embedding model loaded.")

qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

llm = ChatOpenAI(
    base_url=LLM_BASE_URL,
    api_key="sk-no-key-required",
    model="deepseek-r1-distill-qwen-1.5b",
    temperature=0.1,
    max_tokens=2048
)

# State Definition
class GraphState(TypedDict):
    question: str
    docIds: List[str]
    topK: int
    mode: Literal["precise", "summary"]
    chunks: List[Source]
    answer: str
    confidence: float
    latency_ms: int

# Nodes
def retrieve(state: GraphState):
    print(f"[Retrieve] Query: {state['question']}")
    query_vector = embed_model.encode(state["question"]).tolist()
    
    # Component: Filter
    filters = None
    if state["docIds"]:
        filters = models.Filter(
            must=[
                models.FieldCondition(
                    key="docId",
                    match=models.MatchAny(any=state["docIds"])
                )
            ]
        )
        
    result = qdrant.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        query_filter=filters,
        limit=state["topK"]
    )
    hits = result.points
    
    sources = []
    for hit in hits:
        payload = hit.payload or {}
        sources.append(Source(
            docId=payload.get("docId", "unknown"),
            page=payload.get("pageNumber"),
            bbox=payload.get("bbox"),
            text=payload.get("text", ""),
            score=hit.score
        ))
    
    print(f"[Retrieve] Found {len(sources)} chunks")
    return {"chunks": sources}

def generate(state: GraphState):
    if not state["chunks"]:
        return {
            "answer": "I could not find any relevant information in the documents provided.",
            "confidence": 0.0
        }
        
    # Assemble Prompt
    context_text = "\n\n".join(
        [f"[{i+1}] {chunk.text}" for i, chunk in enumerate(state["chunks"])]
    )
    
    system_prompt = (
        "You are a helpful document assistant. Use only the provided context to answer the user's question. "
        "If the answer is not in the context, say 'I cannot answer this based on the document'.\n"
        "Cite sources using [1], [2] format.\n"
        "Keep answers concise and accurate.\n\n"
        f"Context:\n{context_text}"
    )
    
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=state["question"])
    ]
    
    try:
        response = llm.invoke(messages)
        content = response.content
        confidence = 0.85 # Placeholder
    except Exception as e:
        print(f"[Generate] Error: {e}")
        content = "Error generating response."
        confidence = 0.0
    
    return {"answer": content, "confidence": confidence}

# Graph Construction
workflow = StateGraph(GraphState)
workflow.add_node("retrieve", retrieve)
workflow.add_node("generate", generate)

workflow.set_entry_point("retrieve")
workflow.add_edge("retrieve", "generate")
workflow.add_edge("generate", END)

app_graph = workflow.compile()

async def run_rag(req: QueryRequest) -> QueryResponse:
    start = time.time()
    inputs = {
        "question": req.question,
        "docIds": req.docIds or [],
        "topK": req.topK,
        "mode": req.mode,
        "chunks": [], # Initial empty
        "answer": "",
        "confidence": 0.0,
        "latency_ms": 0
    }
    
    result = await app_graph.ainvoke(inputs)
    
    duration = int((time.time() - start) * 1000)
    
    return QueryResponse(
        answer=result.get("answer", ""),
        confidence=result.get("confidence", 0.0),
        sources=result.get("chunks", []),
        latency_ms=duration
    )
