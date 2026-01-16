import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://llm-runtime:8081/v1")

llm = ChatOpenAI(
    base_url=LLM_BASE_URL,
    api_key="sk-no-key-required",
    model="deepseek-r1-distill-qwen-1.5b",
    temperature=0.1,
    max_tokens=2048
)

def generate(prompt: str) -> str:
    # Use system message content from the prompt if possible, or just send as user message
    # For simplicity with the provided build_prompt, we just send it as one block or split it
    # Ideally build_prompt returns system + user parts, but here we just wrap.
    
    messages = [
        SystemMessage(content="You are a strict document QA assistant."),
        HumanMessage(content=prompt)
    ]
    
    try:
        response = llm.invoke(messages)
        return response.content
    except Exception as e:
        print(f"[LLM Client] Error: {e}")
        return "Error generating response."
