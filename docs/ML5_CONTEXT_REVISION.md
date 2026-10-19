# TRAIN context selection and citation revision — October 18, 2026

Status: implementation and model-free validation complete. No revision
generation workload is approved yet. The previous six-question screen held
the naive three-context/4K-byte proposal after one paired regression. Frozen
ML5 generation stays paused at 12/100; live defaults remain unchanged.

## Fixed comparison

- Ten source-linked TRAIN questions over four PDFs: six previously reviewed
  development cases, two new answerable questions and two synthetic unsupported
  probes. The latter ask administrative facts about nonce entities checked
  absent from their entire native TRAIN PDF; they are simple stress probes,
  not representative unanswerable traffic or a calibrated answerability test.
- TRAIN group membership is checked before new PDF/bundle access. New evidence
  is concept blockquote text, matched literally to its native page with
  whitespace removed and typographic ligatures expanded. For a slide with
  plotted tick labels, use each complete bullet claim, excluding the leading
  plot labels whose native extraction order differs. No fuzzy matching.
- Reuse the saved full top-eight CE contexts for the six development cases;
  their original 18K cap was not reached. For four new queries call the actual
  service ingestion, hybrid+concept retrieval (24 candidates) and cross-encoder
  reranking (top eight), scoped to one TRAIN PDF, using an in-memory index.
- Larger comparator: original prompt, up to eight contexts / 18K UTF-8 text
  bytes. Revision: query-aware excerpts, up to six sources / 4K bytes, and a
  source-only citation prompt. Both interventions change together, so effects
  cannot be attributed separately to packing or prompting.
- Fixed heuristic: at most 900 bytes per excerpt, lexical query coverage,
  concept-title/definition cues, CE-order prior and complementary term/source
  coverage; exact-containment deduplication. Source text/notation is preserved.
  Omission markers count against the text byte budget; prompt metadata does
  not. No gold answer, page labels or evaluation results guide selection.
- The revised prompt permits direct reasoning over explicit definitions,
  requires citations to supporting excerpts for factual claims, and requires
  abstention for unsupported requested facts. Syntax diagnostics count missing
  and out-of-range citations; they do not establish semantic support or alter
  generated answers. Missing citations can be appropriate for abstentions.
- Twenty new paired answers, mixed with a fixed seed and opaque answer IDs.
  Same qwen2.5:3b-instruct digest, Ollama version, original system message,
  temperature 0.1, 512-token output cap, 32K context, three CPU threads, no GPU.
  No fitting, network model downloads, frozen question reads or live changes.

## Review and decision

The user delegated answer review to the assistant. No manual grading is
required from Aditya. Save and validate every correctness/grounding (0–2)
and abstention rating before writing a hash receipt and accessing the method
key. The report uses a neutral title and records assistant review explicitly
in methodology/metadata. Prior-case familiarity, common question authorship
and visible context/prompt differences limit blinding and independence.

Report paired revision-minus-larger differences with document-bootstrap 95%
intervals, regression counts, separate development/new/unsupported cohorts,
and correct abstention on the two probes. Only eight answerable cases enter
reference-retention denominators. Empty negative references must not inflate
that audit. Exact quote retention is a conservative lexical proxy, not proof
of semantic evidence loss or answer correctness.

Any paired correctness/grounding regression, additional reference loss, or
incorrect answer on an unsupported probe blocks consideration. Passing this
small development screen still requires further validation; no production
change is automatic and no independent/generalization claim is justified.
Keep generated failures, length stops and missing evidence in the results.
No retries or gold-guided repair. Cache/order and different output lengths
limit any latency comparison.

## Isolation and execution

New code: `ml/retrieval/context_packing.py`, `ml/eval/grounded_prompt.py`,
`ml/eval/context_revision.py`. Existing generation, prompt, client, quality
screen and frozen protocol sources remain sealed and unchanged. Protect
all previous experiment checkpoints, both quality reports and saved ratings/
receipt. Private revision study, source quotes, plan, journal, blind packet,
ratings and key stay under ignored `ml/out/context_revision/`.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.context_revision --prepare
.\.venv-ml\Scripts\python.exe -m ml.eval.context_revision --check
# Only after explicit CPU workload approval and manually started Ollama:
.\.venv-ml\Scripts\python.exe -m ml.eval.context_revision --run
```

Allow roughly **20–40 minutes, potentially longer**, for a three-document
in-memory index with cached CPU embedder/CE models, four new queries and twenty
LLM requests. Six existing context pools are reused without retrieval. A
metadata preflight checks the manually running Ollama before encoder loading;
the runner never starts it. Exclusive retrieval/generation receipts, sealed
plans and durable attempt journals prevent duplicate runs or silent retries.
Existing reports are exclusive-create and cannot be overwritten.

Public aggregate outputs after approval/completion:
`ml/results/context_revision_train_runtime.json` and
`ml/results/context_revision_train.json`. No raw answers or source quotes in
public results. Unit tests use synthetic data only; no UI work is required.

## Model-free verification

**446 Python tests passed in 64.38 seconds**, including fifteen new synthetic
tests for complementary definitions, deduplication, exact text/UTF-8 budgets,
citation numbering, scoped paired plans, negative-reference denominators,
protected state, interrupted/failed attempts, complete ratings before method
key access, rejection of frozen inputs and native TRAIN evidence checks.
One Windows `loky` physical-core discovery warning came from the existing
ranker serialization test: its helper executable was absent, so it fell back
to logical core discovery. No evaluation/model was run. The approved workload
will explicitly cap OMP/MKL/OpenBLAS/loky and torch/Ollama at three threads.

All three new positive reference claims match native TRAIN pages; both nonce
entities are absent from their respective entire source PDFs. An initial
slide-reference check correctly rejected plot tick labels extracted in a
different order. Reference extraction now takes the complete literal bullet
claims, each still checked exactly against the native page. No fuzzy matching,
model loading or generated-answer inspection was used to repair validation.

This protocol document is source-sealed during preparation; record subsequent
execution/review results in the implementation log and aggregate result files.
No frontend change or UI test is part of this subphase.

**Next:** request CPU workload approval, run the paired TRAIN check, then
have the assistant review all twenty answers and report the decision and next
subphase. No user grading is pending.
