# ML5.3 retained generation batches — October 18, 2026

**Current status: 12 answers saved, 88 unstarted; generation paused.** The
latest approved ten-answer batch completed on three CPU threads in 26m 57s.
Integrity checks passed; the original plan and two-thread journal prefix
remain unchanged. No frozen question files were reopened or retrieval repeated.

## Original two-thread timing pair

The initial two-answer batch stopped cleanly
between requests. No failures, unresolved attempts, repeated answers or
quality-based retries occurred. Both responses finished normally (`stop`),
below the 512-token cap. Their content has not been graded.

| Retained answer | Request time | Model loading | Prompt tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| First | 124.8 s | 11.8 s | 1,868 | 61 |
| Second | 230.0 s | 0.02 s | 3,828 | 63 |

Total measured request time: 354.8 seconds (5.9 minutes). Ollama metadata
confirmed `size_vram=0` and context length 32,768 during the batch. The
requests retained two CPU threads, temperature 0.1 and all sealed settings.

The preparation guide's **1–3 hour forecast is superseded** by measurement.
At the two-answer mean, the remaining 98 take about 4.8 hours. Scaling by
prompt characters gives about 7.3 hours: the sample averaged 9,280 characters,
while remaining prompts average 13,952. Character scaling is a heuristic,
not a fitted speed model. Only two answers were measured, both with short
outputs; longer outputs and concurrent laptop work may take more time.

The initial allowance was **roughly 5–8 hours or longer** for the remaining
98 on two threads, or **30–60 minutes** for a next batch of ten. These were
provisional forecasts before the three-thread batch below. Saved answers can be
resumed across batches without regeneration or repeating retrieval.

## Manifest identity correction before generation

The initial unused preparation pinned the local wrapper file's SHA-256.
After manual Ollama startup, its metadata instead advertised the wrapper's
referenced manifest. Diagnosis verified that the referenced blob exists,
matches that SHA-256 and has identical config and model/system/template/
license layer entries. The code now validates that equivalence and retains
both identities; it does not accept arbitrary digest mismatches.

The original unused plan/seal remain archived locally. The corrected plan
preserves all 100 prompts, contexts, opaque IDs/order and generation settings
exactly. No answer had been attempted before correction. Corrected plan file
SHA-256: `5d31b064302e2d78313b888a820da0d91c94a45cf2d1e077bd639e57255da396`.

Prepared/running model: `qwen2.5:3b-instruct`, Ollama 0.40.4. Effective digest:
`357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b`.
Wrapper file SHA-256:
`cd232a7a8d590449a99eb8fe29b614ef9bf3624d2d17faa496e1135ba4188be0`.

The prepared seal hashes the plan file bytes; journal/state bind its canonical
JSON content. Both are checked and recorded distinctly in
`ml/results/ml5_generation_timing.json`. Private prompts, answers and journals
stay ignored. The source-frozen procedure guide remains unchanged after the
first generation; this note records subsequent observations.

## User-requested CPU amendment

Aditya requested **three CPU threads** after the timing pair. The separate
`answer_generation_resources.py` adapter now applies `num_thread=3` to all
remaining requests, with the same options for both retrieval methods. All
other options, model identity, prompts, order and original plan stay sealed.
The two original answers and their journal bytes remain unchanged at two
threads; no answers were regenerated or inspected for quality.

The immutable local `runtime_amendment.json` binds the adapter source, original
plan and original journal prefix. Every later completed answer records the
effective options and amendment hash. Resume rejects missing runtime metadata,
altered original answers or any option change beyond the thread count. Use
the adapter command below for future batches; the original runner retains its
sealed two-thread behavior.

This is a documented resource change after two answers, so the final quality
report must disclose mixed thread settings. Thread changes can affect numeric
execution; identical outputs or a specific speedup are not established.
The original timing pair applies only to two threads. The next batch below
provides measured three-thread timing, rather than assuming proportional speedup.

Configuration and local integrity checks completed without contacting Ollama
or generating answers. The run was paused at 2/100 pending the next approval.

## Approved ten-answer batch on three threads

Aditya explicitly approved the next ten answers. Exactly ten completed, then
the runner paused at 12/100. All ten recorded three CPU threads, zero GPU
layers and the approved amendment hash. Model/Ollama identities and all other
options remained pinned. There were no failed, unresolved or duplicate attempts,
quality-based retries or regenerated answers. All ten stopped normally, below
the 512-token cap. No answer content was inspected for quality or graded.

| Timing statistic | Measured value |
| --- | ---: |
| Batch elapsed time | 26m 57s |
| Mean full request | 161.7 s (2m 42s) |
| Median full request | 108.5 s (1m 49s) |
| Minimum / maximum | 28.9 s / 306.4 s |
| Prompt tokens | 1,757–6,288 |
| Output tokens | 12–223 |
| Total model-load time across ten requests | 8.2 s |

At the batch mean, the remaining 88 require about **4.0 hours**; simple prompt
character scaling gives 3.9 hours. These are rough point extrapolations, not
confidence intervals or guaranteed runtimes. Output length, prompt processing,
cache reuse and concurrent laptop work vary. The two- versus three-thread
samples use different prompts/outputs, so they cannot establish a thread-count
speedup. Aggregate metadata is in `ml/results/ml5_generation_batch10.json`.
No further generation is approved or running. Blind exports remain absent
until all 100 answers finish.

## Interactive latency concern raised during the three-thread batch

Aditya correctly flagged minute-scale answers as unsuitable for an interactive
reader. These requests are real local-LLM generations, using saved contexts;
they exclude retrieval and reranking time. They measure full completion time,
not time to first token. The current live `llm_client.generate` also waits for
a full non-streaming response, and the sidebar explicitly uses an elapsed-time
ticker pending backend streaming. The live client does not explicitly pin
the same context/thread options as this evaluation, so these measurements
must not be presented as an exact live-app benchmark.

A follow-up latency investigation should measure prompt processing, first
token and output generation separately, then compare bounded context budgets
on TRAIN/development inputs and implement end-to-end streaming. Streaming can
reduce the wait for visible text after generation begins; it does not remove
prompt-processing delay. The current journal retains token counts and total/
load duration but not separate prompt/output durations, so it cannot establish
the dominant bottleneck. No such optimization has been implemented or quality
tradeoff evaluated here. Do not tune on frozen questions or replace this
sealed answer-quality experiment with altered prompts midway through it.

## Next

Recommended in light of the usability concern: a separately scoped TRAIN-only
latency investigation before committing to the remaining 88-answer workload.
Any model workload requires approval. Changing the source-frozen live prompt
or LLM client would invalidate the current plan's source checks; keep any
latency experiments separate and explicitly resolve that provenance before
merging such changes. ML5.3 answer-quality grading remains incomplete.

After approval for another batch, resume using
`python -m ml.eval.answer_generation_resources --run --limit 10` from the repository
root with the ML venv. Ollama must be manually running. Identity and journal
checks occur before new requests. Do not remove locks/journals or retry an
uncertain attempt automatically.

No blind packet/key is exported until all 100 answers finish. Then perform
the user-only grading-page checks, grade all answers blindly and run the
aggregate scorer. ML5.4 synthesis follows completed generation and grading;
the frozen retrieval decision remains CE by default.
