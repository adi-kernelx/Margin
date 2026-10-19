# ML5.3 latency investigation — October 18, 2026

Status: the explicitly approved four-request LLM probe completed in roughly
4m 15s. Its measurements identify prompt processing as the main delay in
these full-context stress cases. No live optimization or quality improvement
is claimed. The answer-quality experiment stays paused at 12/100, unchanged.

## Problem and measured evidence

The approved ten-answer generation batch took 26m 57s on three CPU threads.
Mean completion time was 161.7 seconds, median 108.5 seconds, and the range
28.9–306.4 seconds. This is too slow for comfortable interactive use. Those
timings exclude retrieval/reranking and do not measure first visible text.
The live client also waits for a complete response before displaying it.
Its server-selected context/thread settings need not match the evaluation.

The retained grading journal omitted separate prompt/output durations, so
it cannot identify the dominant bottleneck. This separate probe collects the
[Ollama chat timing fields](https://docs.ollama.com/api/chat) and measures
receipt of the first non-whitespace text chunk using the
[streaming API](https://docs.ollama.com/api/streaming). This is client-visible
first text, not an exact server timestamp for the first token.

## Fixed diagnostic design

Four requests: two TRAIN documents, each under two context budgets. A fresh
generic instruction asks for definitions/claims in the supplied excerpts.
There are no gold questions or answers and no answer-quality scoring.

Files come from the previously frozen TRAIN file list, independently checked
against manifest source groups and the frozen split before any bundle text
is read. The service's `concept_text` builds context from cached OKF bundles;
the service's unchanged `build_prompt` builds the QA prompt. No question file,
frozen grading input, embedder, cross-encoder, retrieval index or classifier is
loaded. This is a generation stress probe, not a retrieval benchmark.

| Option | Full context | Bounded context |
| --- | --- | --- |
| Maximum context items | 8 | 3 |
| Context text budget | 18,000 UTF-8 bytes | 4,000 UTF-8 bytes |
| Actual items, first case | 5 | 2 |
| Actual items, second case | 7 | 3 |
| Model | qwen2.5:3b-instruct | same |
| CPU threads / GPU layers | 3 / 0 | same |
| Context allocation | 32,768 tokens | same |
| Temperature / output cap | 0.1 / 128 tokens | same |

Budgets measure text bytes, not tokenizer tokens. Truncation preserves valid
UTF-8 and stops at a word boundary where possible. Prompt labels/question and
template overhead are additional; preparation checks the full prompt against
a conservative byte bound with output/template allowance. The output cap is
128 for both variants, rather than the grading run's 512; length stops are
retained and reported. This is not a comparison of different context-window
allocations. Less supplied evidence can reduce answer quality; this probe
cannot establish that a smaller budget is safe for production.

The two cases are selected for the longest bounded concept contexts, not
representative random traffic. First case order is full then bounded; second
is bounded then full. Each request runs once. Cache reuse, cold loading and
other laptop work remain uncontrolled and must be reported as limitations.
Two cases do not support a statistical generalization or a default switch.

## Integrity, execution and outputs

Implementation: `ml/eval/llm_latency.py`. Local private plan/seal and answer
journal live under ignored `ml/out/llm_latency/`. Prepared plan file SHA-256:
`22f6dae2b457a0259aa070dc8e77aca034d0e61517d684939d5033bbff3a5dee`.
The seal binds sources, selected TRAIN bundle files, local model identity,
options and all four prompts. Hash snapshots protect the existing grading
plan, preparation, answers, state and CPU amendment before/after the probe.
No sealed grading source is modified.

After explicit approval, with Ollama already manually running:

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.llm_latency --run
```

Allow roughly **10–20 minutes, potentially longer**, using three CPU threads
and no GPU. The runner only contacts existing local Ollama, validates model
and version identity, and never starts the server or pulls a model. Each
attempt is journaled durably. Failed/incomplete attempts block automatic
retry; clean checkpoints retain completed requests. Concurrent copies are
blocked by an exclusive lock. An existing result prevents a repeated run.

Successful output `ml/results/llm_latency_train.json` contains only aggregate
and opaque-case runtime metadata: first text, wall time, server loading,
prompt processing, output generation, token counts, output tokens/second and
stop reasons. Raw prompts and answers stay ignored. No quality grading,
frozen retrieval rerun or production default change occurs.

## Measured results

| Case / variant | First visible text | Request total | Prompt processing | Output generation |
| --- | ---: | ---: | ---: | ---: |
| C01 full | 124.6 s | 138.7 s | 120.3 s | 14.1 s |
| C01 bounded | 1.2 s | 10.3 s | 1.1 s | 9.2 s |
| C02 bounded | 14.1 s | 24.3 s | 14.1 s | 10.1 s |
| C02 full | 68.5 s | 81.2 s | 68.5 s | 12.7 s |

Full-context means: first text **96.6 s**, request total **110.0 s**, prompt
processing **94.4 s**, output generation **13.4 s**. Prompt processing accounts
for about **85.8%** of full-context request time in these cases. Full prompts
contained 5,602 and 4,471 tokens. Loading took 4.36 s for the first request
and less than 0.01 s each thereafter, so loading does not explain most delay.

Bounded-context means: first text **7.7 s**, request total **17.3 s**, prompt
processing **7.6 s**, output generation **9.6 s**. Bounded prompts contained
1,431 and 1,084 tokens. Output throughput ranged 9.1–14.0 tokens/s across all
four requests. The 1.2 s first-text sample followed a full prompt sharing a
prefix; uncontrolled cache reuse prevents treating it as cold-start performance.

**All four outputs hit the 128-token limit.** Total request time therefore
measures generation to that cap, not time to a complete answer. Truncated
outputs were retained; no retries or quality judgments occurred. Two selected
cases and cache/order effects do not support a general speedup estimate or
confidence interval. A smaller budget removes or truncates evidence and may
harm correctness/citations; this probe does not authorize a production switch.

The main actionable finding is that streaming alone cannot remove the long
pre-generation wait measured for the full contexts. A bounded-context quality
check on TRAIN is the next experiment, alongside a separately scoped plan for
live streaming. Actual end-to-end retrieval/UI latency remains unmeasured.

## Verification and next step

Fourteen synthetic tests cover UTF-8 budgets, payload parity, first visible
text, timing fields, malformed/incomplete streams, retained truncations,
failed-attempt protection, clean resume, journal integrity, TRAIN gating and
source seals. Full light Python regression suite: **421 passed in 30.39 s**.
Preparation and metadata-only integrity check both succeeded. No model loaded,
real generation or UI test occurred during preparation.

Post-run verification: four unique completed requests, no failures or retries,
terminal state/report/journal hashes match, metrics recomputed from saved
events match the public report, and the probe lock is removed. The grading
checkpoint hashes still match and its completed count stays 12. No frozen
questions were opened or retrieval/model fitting run. Ollama stayed at 0.40.4
and the pinned model digest; options retained three CPU threads and zero GPU
layers. Public report: `ml/results/llm_latency_train.json`, SHA-256
`87ee884c7fbe6767382496ca371449bb6468f4b043bf5ff0a81abb241ff4c879`.
The earlier 421-test suite remains applicable; no code changed during the run.

Next: design a TRAIN answer-quality comparison of full versus bounded context
before adopting a smaller budget. Plan end-to-end streaming separately;
neither live streaming nor context changes are implemented. No additional
LLM workload is approved. Modifying the source-frozen live prompt/client
requires explicit provenance handling for the unfinished grading experiment.
The remaining 88 grading answers and eventual human grading are still pending;
ML5.4 follows completion of that experiment.

Subsequent TRAIN screen: the twelve-answer comparison and delegated assistant
review are complete; see `docs/ML5_CONTEXT_QUALITY.md`. Both budgets retained
all references, but the smaller budget worsened one paired answer and is on
hold. Grading provenance is recorded in methodology; no user rating step is
required for that completed screen. The original frozen experiment remains
separate at 12/100; later grading-procedure amendments must be explicit.
