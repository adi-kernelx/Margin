# Original-prompt excerpt refinement on TRAIN — October 18, 2026

Status: implementation and model-free checks complete; generation is not
approved yet. The preceding factorial screen favored keeping the original
prompt for development, while the old selector still failed individual
regression checks. This subphase changes selection only.

## Selector revision

`ml/retrieval/focused_contexts.py` adds a separate deterministic selector.
Existing selector, prompt, service and sealed experiment sources are unchanged.
Inputs are the question and saved CE top-eight source contexts; no reference,
answer page, generated answer or answerability label influences selection.

- Prefer directly queried concept titles and their earliest defining sentence,
  rather than later keyword-dense background. Preserve complementary named
  concepts. Use generic token matching, modest plural normalization, candidate
  query-term frequencies, lexical density and a CE-order tie-breaking prior.
- Place chosen evidence in selection order; do not restore the old CE order
  that can put a weak background passage first.
- Add another source only when it covers a previously uncovered query target
  and has at least 60% of the first evidence window's content score. Rare query
  terms (present in at most half of candidates) guide complementary coverage;
  use all active terms if none are rare. Absent query words cannot be covered.
- Keep a defining sentence/bullet plus up to one neighbor on either side when
  it provides relevant query content, qualification, negation or a definition.
  Neighbor windows fit 1,400 UTF-8 bytes. A longer atomic sentence may use the
  total budget, so no sentence is sliced to meet an arbitrary per-window cap.
- Collapse duplicate units and repeated title prefixes, retaining an ambiguous
  final title to avoid deleting a natural sentence subject. Skip obvious
  midword-ellipsis metadata fragments while keeping complete body statements.
  Bullet boundaries and sentence boundaries are used; segmentation is still
  heuristic and may misread mathematical punctuation or abbreviations.
- Stop when no eligible complementary evidence remains instead of filling the
  budget. Hard limits are four source items and 4,000 UTF-8 text bytes, including
  omission markers. A sentence larger than the total budget is ineligible.
  Text, mathematical symbols and page/source metadata are not rewritten.
- If no query term appears in any candidate, fall back to the first eligible
  source/unit in CE order. This is not an answerability classifier and cannot
  guarantee relevance. Empty selection is possible if no whole unit fits.

The original QA prompt and system message render every condition. Changes to
context count/order/metadata naturally change source labels, but no new
instruction or refusal wording is introduced. Citation syntax checks remain
diagnostics only; semantic grounding is assessed in the delegated review.

## Fixed three-way comparison

Use the same ten previously reviewed TRAIN cases / four PDFs, with eight
answerable cases and two synthetic unsupported probes. All are development
data with repeated exposure; no independently authored or fresh holdout claim.
Check the sealed factorial plan/state, model/source hashes and TRAIN file
membership before constructing any new prompts.

Generate **thirty fresh answers**, ten per condition:

| Condition | Context input | Prompt |
| --- | --- | --- |
| `full_original` | Exact saved top-eight / 18K comparator packet | Original QA |
| `previous_original` | Exact old six-source / 4K excerpt packet | Original QA |
| `refined_original` | New focused windows from the full saved packet | Original QA |

Previous generated answers are protected, not reused as outputs. Reuse cached
context pools without retrieval, PDF extraction, encoder loading or fitting.
Neither original frozen question source is opened. No live change is included.

One three-condition block per question. Seed 20261021 permutes question order,
condition identities and order assignments. Six core blocks cover every
three-condition permutation once; three cyclic orders and one extra order
make ten blocks, with each condition in each position three or four times.
This balances position reasonably but does not eliminate cache/carryover.
No generation seed or reproducibility across model runs is claimed.

Keep the same model digest/version/system, temperature 0.1, 512-token output
cap, 32K allocation, three CPU threads and zero GPU. Retain every attempted
answer, including truncation/refusal, with no quality-guided retries or repair.
Ollama must be manually running; the assistant never starts it.

## Review, scoring and decision

The assistant reviews all thirty opaque answers using the existing 0–2 rubric,
references and actual supplied contexts. Complete ratings must be saved and
validated before a hash receipt is written and before the scorer reads the
condition-bearing plan/key. Ratings cannot be edited after disclosure. No
manual grading is required from Aditya. The result title stays neutral;
metadata records assistant review, no human validation, prior familiarity,
common authorship and partial blinding from visible context differences.

Report per-condition means and paired refined-minus-full, refined-minus-old,
and old-minus-full differences with the unchanged 2,000-resample whole-document
bootstrap and 95% intervals. Historical cohorts are separate; the old
`new_answerable` cohort label refers to its introduction in an earlier study,
not fresh data here. Multiple unadjusted contrasts, four clusters, a single
reviewer and one output per cell make these exploratory. No independent
validation, noninferiority or population causal claim.

Audit complete-quote retention after selection, using only the eight answerable
cases; empty negative references must not inflate denominators. This lexical
proxy is not semantic evidence sufficiency. Keep all misses in the study;
never repair selection using gold after the plan is sealed. Count citation
syntax failures separately from semantic support and correct abstention on
the two synthetic probes. Their small denominator cannot establish risk.

Any refined-condition correctness/grounding regression versus either fresh
comparator, additional reference loss versus full, or failed unsupported probe
blocks acceptance. Passing remains a small development screen and does not
automatically change live defaults. All thirty outputs must finish before
review/scoring; no answer selection based on intermediate quality.

## Workload and isolation

New runner: `ml/eval/context_refinement.py`; new tests:
`ml/tests/test_focused_contexts.py` and `ml/tests/test_context_refinement.py`.
Private plan, evidence, journal, blind packet, ratings and key stay ignored
under `ml/out/context_refinement/`. Source/model/prior-state hashes are sealed,
outputs are exclusive-create and a durable attempt journal/generation lock
protects against duplicate or uncertain retries. Completed previous/frozen
answers and reports remain unchanged. No UI operation is part of this subphase.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.context_refinement --prepare
.\.venv-ml\Scripts\python.exe -m ml.eval.context_refinement --check
# Only after separate CPU approval, with manually started Ollama:
.\.venv-ml\Scripts\python.exe -m ml.eval.context_refinement --run
```

Allow roughly **15–30 minutes, potentially longer**, for thirty requests on
three CPU threads. Set OMP/MKL/OpenBLAS/loky limits to three, disable GPU
visibility and model downloads. No embedder/cross-encoder work is needed.
Metadata identity checks precede generation and recur before each request.

Public aggregates after completion/review:
`ml/results/context_refinement_train_runtime.json` and
`ml/results/context_refinement_train.json`. Raw source quotes, answers,
ratings, model artifacts and PDFs must not be committed.

## Model-free verification

The full Python suite passed **487 tests in 27.17 seconds, no warnings**,
including twenty-three new synthetic selector/runner cases. They cover early
definition precedence, complementary concepts, qualifiers/negation, bullets,
metadata truncation, UTF-8/atomic-sentence budgets, plural search normalization,
CE fallback, conservative duplication, exact comparator/prompt reuse,
three-condition ordering, corrupt inputs, protected/failed attempts, aggregate
denominators, paired scoring and complete review before condition disclosure.
An unsupported-probe error independently blocks acceptance even when every
condition makes the same error and no paired regression exists.

Initial synthetic tests caught removal of a definition subject during title
cleanup; retaining the last ambiguous prefix fixes that. Code review also
found symmetric containment deduplication could discard a broader window
adding a new fact; only wholly redundant candidate windows are now rejected,
with a targeted regression test. Both were corrected before plan sealing or
model work. No original implementation or live default was changed.

This protocol is source-sealed during preparation. Record later execution and
results in a separate results note and the implementation log. **Next:**
seal/check the plan, request workload approval, then generate and
assistant-review all thirty answers before recommending the next step.
