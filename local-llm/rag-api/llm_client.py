"""Chat completion for the assistant, with token counts and speeds.

The default is a local Ollama with qwen2.5:3b-instruct, small enough for a
laptop without a GPU. Ollama is called through its native /api/chat, which
reports exact token counts and timings and accepts an explicit context size.
Any other server (LLM_API=openai, e.g. llama.cpp in the Docker setup) uses
the OpenAI-compatible /chat/completions, which reports token counts only.
"""

import os
import time

import httpx

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b-instruct")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "512"))
# Prompts are ~2K tokens; 8K leaves room without reserving a 32K KV cache.
LLM_NUM_CTX = int(os.getenv("LLM_NUM_CTX", "8192"))
# CPU generation of a few hundred tokens can take minutes.
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "300"))
LLM_API = os.getenv("LLM_API", "ollama" if ":11434" in LLM_BASE_URL else "openai")

SYSTEM = "You are a strict document QA assistant."


class LLMError(RuntimeError):
    pass


def _rate(tokens, nanoseconds):
    return round(tokens / (nanoseconds / 1e9), 1) if tokens and nanoseconds else None


def ollama_stats(body: dict) -> dict:
    """Token counts and speeds from an Ollama /api/chat reply (durations are in ns)."""
    prompt, output = body.get("prompt_eval_count"), body.get("eval_count")
    return {
        "llm_model": body.get("model", LLM_MODEL),
        "prompt_tokens": prompt,
        "output_tokens": output,
        "prompt_tps": _rate(prompt, body.get("prompt_eval_duration")),
        "output_tps": _rate(output, body.get("eval_duration")),
        "load_ms": round(body.get("load_duration", 0) / 1e6),
        "prompt_ms": round(body.get("prompt_eval_duration", 0) / 1e6),
        "generation_ms": round(body.get("eval_duration", 0) / 1e6),
        "context_window": LLM_NUM_CTX,
        # The answer stopped at the token cap rather than finishing.
        "truncated": body.get("done_reason") == "length",
    }


def generate_with_stats(prompt: str) -> tuple:
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
    started = time.perf_counter()
    try:
        if LLM_API == "ollama":
            root = LLM_BASE_URL.rstrip("/").removesuffix("/v1")
            response = httpx.post(f"{root}/api/chat", timeout=LLM_TIMEOUT, json={
                "model": LLM_MODEL, "messages": messages, "stream": False,
                "options": {"temperature": 0.1, "num_predict": LLM_MAX_TOKENS, "num_ctx": LLM_NUM_CTX},
            })
            response.raise_for_status()
            body = response.json()
            return body["message"]["content"], ollama_stats(body)
        response = httpx.post(f"{LLM_BASE_URL.rstrip('/')}/chat/completions", timeout=LLM_TIMEOUT, json={
            "model": LLM_MODEL, "messages": messages, "temperature": 0.1, "max_tokens": LLM_MAX_TOKENS,
        })
        response.raise_for_status()
        body = response.json()
        usage = body.get("usage") or {}
        return body["choices"][0]["message"]["content"], {
            "llm_model": LLM_MODEL, "prompt_tokens": usage.get("prompt_tokens"),
            "output_tokens": usage.get("completion_tokens"),
            "generation_ms": round((time.perf_counter() - started) * 1000),
            "truncated": body["choices"][0].get("finish_reason") == "length",
        }
    except Exception as e:
        print(f"[LLM Client] Error: {e}")
        raise LLMError(f"The language model at {LLM_BASE_URL} ({LLM_MODEL}) did not answer: {e}") from e


def generate(prompt: str) -> str:
    return generate_with_stats(prompt)[0]


def status(timeout: float = 1.5) -> dict:
    """Whether the LLM server answers and has the configured model. Never raises."""
    try:
        response = httpx.get(f"{LLM_BASE_URL.rstrip('/')}/models", timeout=timeout)
        response.raise_for_status()
        names = {model.get("id") for model in response.json().get("data", [])}
    except Exception:
        return {"llm": "offline", "model": LLM_MODEL}
    return {"llm": "online" if LLM_MODEL in names else "missing", "model": LLM_MODEL}
