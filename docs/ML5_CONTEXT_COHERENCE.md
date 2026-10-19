# Same-page evidence coherence and broader TRAIN check — October 18, 2026

Status: implementation and preparation; model workload awaits separate approval.
This is one bounded follow-up to the completed excerpt refinement. Keep the
original QA/system prompts. Report its outcome and stop automatic context
tuning; do not extend ML5 with another optimization cycle by default.

## Why this comparison

The previous selector cut mean request time to 5.1 seconds in a small cached
TRAIN batch but failed an individual correctness/grounding gate. Its remaining
classification failure occurred despite all needed facts being present across
two sources from one page. Consolidating those statements is a diagnostic
hypothesis, not an established cure for model behavior or generation noise.

`ml/retrieval/coherent_contexts.py` is separate from the sealed selector and
service. It first uses the unchanged focused selection, then considers merging
or expanding a short local evidence window:

- A common existing candidate must contain every selected unit. Merely sharing
  a page does not authorize concatenation. Match after whitespace removal,
  preserving case, punctuation, negation and mathematical symbols.
- Require the same positive integer page and explicit document identity.
  Conflicting fingerprint/docId, missing identity or incompatible pages prevent
  consolidation. Corpus-scoped cached inputs receive their validated PDF identity
  before selection. Different documents never merge because page numbers match.
- Find complete units in an actual containing source, retain original within-
  source order and at most one intervening unselected unit between matches.
  Keep that intervening text; do not pretend distant statements are adjacent.
- Retain a short qualification chain: up to one preceding and two following
  units containing the existing generic qualifier/definition markers. A common
  source can be a passage or a full concept body. Use that containing source's
  original metadata, including its own verification status; do not inherit a
  child concept label or verification claim.
- Preserve natural definition subjects when ignoring assembler title prefixes
  for matching. Source unit text is not paraphrased. Among eligible carriers,
  prefer the shortest resulting window, then candidate order.
- Window limit 1,400 UTF-8 bytes; global limits remain four sources / 4,000 text
  bytes. Extra text must fit the global budget without dropping other selected
  facts. Over-budget, distant, unaligned or ambiguous cases retain the focused
  output. A longer atomic sentence already selected by that algorithm remains
  intact as fallback rather than being cut to the window limit.

No gold quote, answer page, answerability label or generated answer is passed
to selection. These are conservative lexical/segmentation heuristics, not a
semantic support or answerability guarantee. No live default is changed.

## Fixed workload and broader coverage

`ml/eval/context_coherence.py` fixes **18 TRAIN cases across six PDFs**, three
per PDF: two answerable cases and one new synthetic unsupported entity probe.
The twelve answerable cases comprise four previously reviewed sentinels and
eight new prompts. Four sentinels preserve the comparison/classification,
continuous-split and boundary checks; eight new prompts cover other definitions,
qualifications, validation data, sparse coverage, networking and optimization.

The six sources are the four prior development PDFs plus the TRAIN networking
chapter and steepest-descent notes. Validate every filename against the frozen
protocol TRAIN list, canonical manifest and frozen source groups **before**
opening any PDF or bundle. Build private references from exact native page
line slices or cached bundle metadata; expand PDF ligatures and check references
against their native pages. Verify each synthetic nonce is absent from the
entire corresponding TRAIN PDF. No frozen question file is opened, including
for TRAIN filtering. Neither frozen inference nor generation is repeated.

These new prompts are assistant-authored development data. They are new to this
screen, not independent authorship or an untouched holdout. Preserve cohorts
separately and report the twelve answerable cases separately from the six
unsupported probes so easy refusals do not hide answer-quality failures.

Generate **36 fresh answers**, two per question:

| Condition | Input | Prompt |
| --- | --- | --- |
| `full` | CE top eight, original 18K text-byte cap | Original QA/system |
| `bounded` | Focused selection plus conservative coherence merge, four sources / 4K bytes | Original QA/system |

Reuse the four exact full-context sentinel pools from the sealed completed
TRAIN plan. Perform fourteen fresh queries through the actual service's
hybrid-concepts retrieval and cross-encoder reranking in an in-memory index
containing only these six TRAIN PDFs. No ranker fitting, link-policy change,
persistent index replacement or source-bundle rebuild. Cached older generated
answers are protected and never reused as new outputs.

Shuffle question blocks with Random seed 20261022. Keep each pair together and
alternate which condition runs first, yielding nine blocks per order. Assign
opaque answer IDs after scheduling; no generation seed is introduced. Preserve
cache/order/output-length limitations in timing reports.

Pin the same local qwen2.5:3b-instruct identity and Ollama version, temperature
0.1, 512-token maximum, 32K allocation, three CPU threads and zero GPU.
Manually started Ollama only; no service start or model download. Keep every
attempt/output, including refusals or truncation. Do not quality-retry,
exclude retrieval misses, repair quotes or tune the selector after sealing.

Allow roughly **25–50 minutes, potentially longer**, for in-memory indexing,
fourteen retrievals and thirty-six LLM requests. Obtain the original brief's
workload approval before loading the encoders or LLM. A durable exclusive
retrieval-start marker prevents an automatic rebuild after interruption; a
sealed plan plus existing journal/lock handling protects generation attempts.
Failed or uncertain attempts require diagnosis, not silent retry.

## Review, statistics and stopping rule

The assistant reviews every opaque answer against its actual supplied contexts
and private references using the existing 0–2 correctness/grounding rubric.
No manual grading is required from Aditya. Save and validate all ratings before
the scorer writes a hash receipt and opens the condition-bearing study/plan/key
for grading. Do not edit ratings after disclosure. Neutral result title with
truthful assistant-review metadata, no human validation and explicit partial
blinding/shared-authorship/prior-familiarity limitations.

Report condition means and paired coherent-minus-full differences with the
unchanged 2,000-resample whole-document bootstrap and 95% intervals. Include
answerability strata, the four known sentinels, eight fresh answerable prompts
and six synthetic unsupported probes separately. Six document clusters and
single outputs per cell remain small; no population, noninferiority or live
latency claim. Citation syntax diagnostics do not substitute for semantic
grounding. Complete-quote retention counts only answerable cases.

Any coherent-condition correctness/grounding regression versus fresh full,
additional quote loss versus full, or incorrect unsupported answer yields
`defer_coherent_selector`. Otherwise report
`screen_passed_no_automatic_adoption`, with all uncertainty intact. No automatic
live change follows either outcome. **This comparison ends the current optional
context-tuning cycle:** recommend considering or deferring the candidate and
return to the outstanding original ML5 answer study / synthesis. Do not silently
start another tuning run, ML6 or the remaining frozen answers.

## Isolation, commands and verification

Protect all prior checkpoint/report files, sealed sources and model identity.
New private native references, study, retrieved plan, journal, blind packet,
ratings and key stay ignored under `ml/out/context_coherence/`. Public numerical
aggregates only: `ml/results/context_coherence_train_runtime.json` and
`ml/results/context_coherence_train.json`. No raw PDF evidence or answers enter
commits. Runtime is an immutable pre-review snapshot; the separate quality
report records the later review outcome. No UI operation or commit is included.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.context_coherence --prepare
.\.venv-ml\Scripts\python.exe -m ml.eval.context_coherence --check
# Only after workload approval, with Ollama manually running:
.\.venv-ml\Scripts\python.exe -m ml.eval.context_coherence --run
# After all 36 opaque answers have been reviewed and ratings saved:
.\.venv-ml\Scripts\python.exe -m ml.eval.context_coherence --score ml/out/context_coherence/ratings.assistant.json
```

Focused synthetic tests currently pass: **24 checks**, covering shared-source
containment, provenance conflicts, distant/disjoint units, negation/case,
qualifications, natural subjects, UTF-8 budgets/fallback, counterbalanced pairs,
gold isolation, private-data-free aggregates, interrupted retrieval/generation,
complete ratings before disclosure, source seals, frozen-path rejection and
unsupported failures even without paired regressions. The full model-free
Python suite passed **511 tests in 30.76 seconds, no warnings** before sealing.
Later execution/results go in a separate results
note so this protocol stays source-sealed.

The initial workflow-test attempt could not create pytest's external sandbox
temporary directory. Re-running with a dedicated workspace basetemp resolved
the environment issue; no assertion failure was hidden or suppressed.
