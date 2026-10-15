"""Chat completion through any OpenAI-compatible server.

The default is a local Ollama with qwen2.5:3b-instruct, small enough for a
laptop without a GPU. The Docker setup points LLM_BASE_URL at llama.cpp and
sets LLM_MODEL to its Llama 3.1 8B model.
"""

import os

import httpx

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b-instruct")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "512"))
# CPU generation of a few hundred tokens can take minutes.
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "300"))

SYSTEM = "You are a strict document QA assistant."


class LLMError(RuntimeError):
    pass


def generate(prompt: str) -> str:
    try:
        response = httpx.post(f"{LLM_BASE_URL.rstrip('/')}/chat/completions", timeout=LLM_TIMEOUT, json={
            "model": LLM_MODEL,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": LLM_MAX_TOKENS,
        })
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[LLM Client] Error: {e}")
        raise LLMError(f"The language model at {LLM_BASE_URL} ({LLM_MODEL}) did not answer: {e}") from e
