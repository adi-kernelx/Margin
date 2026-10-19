# TRAIN packing and prompt factorial comparison — October 18, 2026

Status: implementation and model-free checks complete; generation is not yet
approved. The previous combined revision was held after three correctness
and four grounding regressions, despite faster generation and complete
reference retention. This subphase separates the two changed components.

## Fixed diagnostic design

Reuse the ten previously reviewed TRAIN questions over four PDFs, with their
exact saved context packets from `ml/out/context_revision/plan.json`. All are
now development data: six earlier cases, two later answerable cases and two
synthetic unsupported probes. None is an independent or fresh holdout.
Membership in the frozen TRAIN file list is checked before cached plan
access. Prior study, plan/state and source hashes must still match.

Generate **forty fresh answers**, one per question and condition:

| Condition | Context | Prompt |
| --- | --- | --- |
| `full_original` | Saved eight-item / 18K-byte comparator | Original QA |
| `full_grounded` | Identical saved comparator text | Revised grounded QA |
| `selected_original` | Saved six-source / 4K-byte excerpts | Original QA |
| `selected_grounded` | Identical saved selected excerpts | Revised grounded QA |

Both packing levels reuse the exact previous text and metadata; no heuristic
is changed or rerun. Both prompt functions remain sealed. Original prompt
rendering includes concept labels; grounded rendering uses page labels. The
prompt factor therefore means the complete prompt package, including that
formatting, rather than one wording instruction in isolation. Gold references
remain grading-only and never enter prompts except as naturally present
source evidence. Previous generated answers are protected, not reused as
new condition outputs.

Use the same model digest, Ollama version, original system message,
temperature 0.1, 512-token cap, 32K context allocation, three CPU threads and
zero GPU layers. One request at a time; no generation seed is introduced and
no determinism across runs is claimed. All new answers are retained, including
refusals, truncation and failures; no quality-based retries or selection.

Question order and condition identities are permuted with seed 20261020.
Each question forms a contiguous four-condition block. Eight core blocks
use four counterbalanced orders twice, with each condition in each position
and each directed within-block predecessor equally represented. Two extra
blocks use two orders once more. Shuffle the ten block-order assignments;
over all ten, each condition occupies each position two or three times.
This improves order balance but does not remove prompt cache/carryover
effects. Timing remains descriptive, with different output lengths.

The runner loads **no embedder, cross-encoder or PDF extraction pipeline**,
performs no retrieval or fitting, and reads neither frozen question source.
Only the already manually running Ollama receives generation requests.
The previous experiments, raw answers, ratings and public reports are
protected by hashes; live defaults and frozen ML5 generation stay unchanged.

## Review and analysis

The assistant reviews every opaque-ID answer using the existing 0–2
correctness/grounding rubric and abstention fields. Complete and validate all
forty ratings before a hash receipt is written and before the scorer reads
the condition-bearing plan/private key. No manual grading is required from
Aditya. The public title stays neutral; methodology records assistant
review and absence of human validation. All cases were seen previously,
common question authorship and visible context differences limit reviewer
independence and blinding. Do not edit ratings after unblinding.

Report per-condition means and these paired contrasts, computed within each
question before resampling complete source-document clusters:

- Packing at the original prompt: selected/original minus full/original.
- Packing at the grounded prompt: selected/grounded minus full/grounded.
- Prompt at full context: full/grounded minus full/original.
- Prompt at selected context: selected/grounded minus selected/original.
- Combined revision versus full/original, as a fresh replication of the
  previous combined comparison; older outputs are not pooled into this batch.
- Packing main effect: average of the two packing contrasts.
- Prompt main effect: average of the two prompt contrasts.
- Interaction: prompt effect under selection minus prompt effect under full
  context. A nonzero interaction means a component's measured effect depends
  on the other component; avoid relying only on main effects.

Use the unchanged 2,000-resample document bootstrap and 95% intervals.
Only four clusters, one output per cell, selected development cases and
multiple unadjusted contrasts make this exploratory. Do not turn an interval
into an independent validation or population-level causal claim. Report
historical question cohorts separately and correct abstention for the two
synthetic probes; their tiny denominator cannot estimate a reliable risk.

Reference retention uses only the eight answerable cases; empty negative
references cannot inflate coverage. The same cached contexts give the same
reference availability under both prompt levels. Citation syntax diagnostics
are not semantic support judgments. Score every answer as generated.

For each of the three candidate conditions, count correctness/grounding
regressions against the fresh full/original comparator, extra reference
losses where relevant, and incorrect unsupported answers. Any blocks that
candidate from consideration. Passing is only a small development screen;
the experiment's decision is always diagnostic with **no automatic live
change or winning-default selection**.

## Preparation, execution and isolation

New runner: `ml/eval/context_factorial.py`; model-free tests:
`ml/tests/test_context_factorial.py`. No existing sealed source is edited.
The plan includes all prompts before any new generation, plus source hashes,
model identity and protected checkpoints. Private data stays ignored under
`ml/out/context_factorial/`. Every output is exclusive-create. An exclusive
generation lock and durable journal preserve completed answers; failed or
uncertain attempts stop automatic resumption and require diagnosis.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.context_factorial --prepare
.\.venv-ml\Scripts\python.exe -m ml.eval.context_factorial --check
# Only after separate CPU approval, with Ollama manually running:
.\.venv-ml\Scripts\python.exe -m ml.eval.context_factorial --run
```

Allow roughly **25–50 minutes, potentially longer**, for forty LLM requests
at three CPU threads. Set OMP/MKL/OpenBLAS/loky limits to three as well;
disable GPU visibility and model downloads. Metadata checks occur before
generation; the runner never starts Ollama. No encoder workload is needed.

Public aggregate outputs after generation/review:
`ml/results/context_factorial_train_runtime.json` and
`ml/results/context_factorial_train.json`. Raw answers, source quotes,
ratings, model artifacts and PDFs must not be committed.

This protocol is source-sealed at preparation; later execution/results
belong in a separate results note and the implementation log. No UI work is
part of this subphase.

## Verification before approval

The full model-free Python suite passed **464 tests in 75.54 seconds**, with
no warnings. Eighteen new synthetic tests cover exact cached context reuse,
all four prompt/context combinations, counterbalanced positions, corrupt or
cross-source cache rejection, text limits, aggregate-only timing, unsupported
reference denominators, protected state, failed attempts without retries,
paired main/simple effects and interaction, plan/source tampering, complete
ratings before plan/key access, unsupported-error counts and TRAIN/frozen
input routing. Existing sealed code and frontend sources were unchanged.

**Next:** verify the prepared plan/source seal, request workload approval,
run forty requests, then assistant review and paired factorial scoring before
recommending the next change. No user grading is pending and no model work
has been started by this preparation.
