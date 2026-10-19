# TRAIN packing and prompt factorial comparison — October 18, 2026

**Completed: all three candidate conditions remain on hold.** This diagnostic
points more strongly to the revised prompt package as a problem than to a
large average packing effect. Packing with the original prompt is faster and
closer to baseline, but still has individual quality regressions. No candidate
passes the predeclared screen. Live defaults and the frozen retrieval decision
remain unchanged; frozen ML5 generation stays paused at 12/100.

Aditya approved all forty requests. The fixed source-sealed design is in
`docs/ML5_CONTEXT_FACTORIAL.md`: ten previously reviewed TRAIN cases over four
PDFs, crossed with two exact cached context packets and two sealed prompts.
All forty outputs are fresh; older answers are protected and are not pooled
into this batch. No retrieval, encoder loading, fitting, PDF extraction,
frozen question read or Ollama startup was performed. Generation used the
same qwen2.5:3b-instruct digest, Ollama 0.40.4, three CPU threads, zero GPU,
32K allocation, temperature 0.1 and a 512-token cap.

## Quality

The assistant reviewed all forty opaque answers against their actual supplied
contexts and references, saved/validated the complete ratings, then the scorer
wrote a hash receipt before reading the condition-bearing plan/private key.
Ratings were not edited after disclosure. The title stays neutral; methodology
records assistant review and no human validation. Previously seen questions,
shared authorship and visible context differences limit independence/blinding.
No manual grading is required from Aditya for this completed comparison.

| Condition | Correctness, 0–2 [95% CI] | Grounding, 0–2 [95% CI] | Mean request time |
| --- | --- | --- | ---: |
| Full context + original prompt | 1.900 [1.727, 2.000] | 1.800 [1.455, 2.000] | 49.2 s |
| Full context + grounded prompt | 1.600 [1.400, 1.875] | 1.500 [1.167, 1.875] | 47.8 s |
| Selected excerpts + original prompt | 1.800 [1.600, 2.000] | 1.900 [1.667, 2.000] | 21.1 s |
| Selected excerpts + grounded prompt | 1.600 [1.400, 1.875] | 1.400 [1.091, 1.778] | 17.9 s |

The following differences are computed within each question, then resample
entire source documents using the unchanged 2,000-resample bootstrap. Positive
means a higher score for selection or for the grounded prompt, respectively.

| Paired contrast | Correctness difference [95% CI] | Grounding difference [95% CI] |
| --- | --- | --- |
| Packing at original prompt | -0.100 [-0.400, 0.200] | +0.100 [-0.333, 0.500] |
| Packing at grounded prompt | 0.000 [0.000, 0.000] | -0.100 [-0.273, 0.000] |
| Grounded prompt at full context | -0.300 [-0.444, -0.111] | -0.300 [-0.444, -0.111] |
| Grounded prompt at selected context | -0.200 [-0.600, 0.250] | -0.500 [-0.909, 0.111] |
| Combined revision versus full/original | -0.300 [-0.444, -0.111] | -0.400 [-0.600, -0.125] |
| Packing main effect | -0.050 [-0.200, 0.100] | 0.000 [-0.200, 0.227] |
| Prompt main effect | -0.250 [-0.500, 0.063] | -0.400 [-0.625, 0.000] |
| Interaction | +0.100 [-0.200, 0.400] | -0.200 [-0.545, 0.250] |

The prompt main effect averages prompt changes at both packing levels. The
packing main effect averages packing changes under both prompts. Interaction
is the prompt effect under selection minus the prompt effect under full
context. Its intervals include zero; this does not establish absence of
interaction. A degenerate zero interval means these particular graded pairs
had identical differences, not that the true effect is known precisely.

Only four document clusters, one generated answer per cell, selected TRAIN
questions and multiple unadjusted comparisons make all these intervals
exploratory. In particular, the average prompt-effect correctness interval
includes zero, and its grounding interval touches zero. The conditional
full-context prompt contrast excludes zero in this sample, but this is not
independent validation or proof of a general causal effect. The prompt factor
includes formatting/labels as well as wording. Do not isolate one instruction
as the proven cause or infer packing noninferiority from near-zero means.

| Candidate versus fresh full/original | Correctness regressions | Grounding regressions | Unsupported errors | Decision |
| --- | ---: | ---: | ---: | --- |
| Full + grounded | 3/10 | 3/10 | 0/2 | Hold |
| Selected + original | 2/10 | 1/10 | 0/2 | Hold |
| Selected + grounded | 3/10 | 4/10 | 0/2 | Hold |

Every condition correctly abstained on **2/2 synthetic unsupported probes**.
The degenerate [1, 1] interval is not a reliable false-answer-rate guarantee.
Both context packets retained every reference for **8/8 answerable cases**;
no additional reference loss was observed. Out-of-range citation mentions
were zero under every condition, despite semantic citation failures.

The six earlier development cases had correctness/grounding means of
1.833/1.667 for full/original, 1.500/1.333 for full/grounded, 1.667/1.833 for
selected/original and 1.500/1.167 for selected/grounded. The two later-added
answerable cases scored 2.000/2.000 under both original-prompt conditions
and 1.500/1.500 under both grounded-prompt conditions. The report's legacy
`new_answerable` cohort label refers to their introduction in the previous
study; those cases are also previously seen development data here.

## Failure review and interpretation

The original prompt with selected excerpts answered the earlier comparison
case correctly in this batch, but its two correctness regressions involved an
incomplete necessary-versus-sufficient classification and an unsupported extra
characterization of categorical splits. The latter also lost grounding credit.
The grounded prompt still produced unjustified or contradictory refusal,
incorrect source-attribution claims, missing citations and muddled definition
relations. No lost quote or output truncation explains these failures.

Scores follow the earlier rubric. Correct facts with explicit false source
attribution lose grounding; a complete refusal on an answerable case scores
zero. A mixed refusal that nevertheless answers part of the question receives
partial credit. An accurate but incomplete classification can receive partial
correctness with full grounding for the facts it actually asserts. Uncited but
source-supported facts lose grounding rather than being treated as entirely
unsupported. Straightforward deductions from cited evidence are allowed;
redundancy alone is cosmetic, while substantive unsupported additions cost
credit. Full private rationales were saved before disclosure. Some distinctions
are judgment-sensitive, reinforcing the single-reviewer limitation.

**Decision:** retain the original prompt as the basis for further development,
hold both the grounded prompt package and the current selected-excerpt
candidate, and make no live default change. Packing-only looks more promising
for latency than the combined revision, but its regressions block adoption.

## Runtime and verification

Forty unique requests completed in **22m 41s** of active generation, including
about 22m 40s of request time. No failed, unresolved or duplicate attempt,
retry or 512-token length stop occurred. Condition order was counterbalanced
within question blocks, with each condition in each position two or three
times overall. Prompt cache/carryover, thermal or concurrent machine load and
different output lengths remain timing limitations. These selected TRAIN
measurements are not representative live latency or a cross-run speed claim.

| Mean per condition (10 requests each) | Full/original | Full/grounded | Selected/original | Selected/grounded |
| --- | ---: | ---: | ---: | ---: |
| First visible text | 43.7 s | 42.8 s | 15.8 s | 14.4 s |
| Request total | 49.2 s | 47.8 s | 21.1 s | 17.9 s |
| Server prompt processing | 43.6 s | 42.1 s | 15.8 s | 14.4 s |
| Server output generation | 5.5 s | 5.0 s | 5.3 s | 3.5 s |
| Prompt tokens | 1,730.5 | 1,752.8 | 788.8 | 813.1 |
| Output tokens | 56.9 | 49.9 | 57.7 | 40.2 |

The model-free Python suite passed **464 tests in 75.54 s, no warnings**
before preparation; no implementation source changed afterward. Six non-UI
parser tests passed after generation. The actual offline parser validated
forty opaque answers, ten questions, the canonical packet hash and all saved
ratings in Node; no browser/UI was operated.

Recomputed runtime aggregates, per-condition/paired/cohort scores, interactions,
candidate gates and abstention results match the reports. Verified forty unique
started/complete pairs, complete state, removed lock, plan/journal/packet/key/
ratings/receipt hashes and **all 34 protected checkpoint files**. Existing
answers/reports, unrelated frontend edits and frozen model sources are intact.
No commit was made.

Public aggregate outputs:

- `ml/results/context_factorial_train_runtime.json`, SHA-256
  `964e0a684db429c67f422d9f436752c5eecd24e2ff09428f1170e63a87bf269d`.
- `ml/results/context_factorial_train.json`, SHA-256
  `7a81c3e66a30b7ac478bcaaa2c9529f47f47cf0c0a02adf9758e9cb939bdeb99`.

Private preparation plan file SHA-256:
`b841207d671109ff7712452432677817a17713ca55a99c653c99bf16773504e2`.
Canonical generation-plan SHA-256:
`f92eba66e44002dd94f79fcb7ddc5335f0ea3dac96ecc48fb9ad664ce665c05b`.
Private ratings SHA-256:
`4c3120184aecab7ff80b2e62bb32e58d2d6b6087ca2a9d7746df836d2a0bea14`.
Review receipt SHA-256:
`f96d847b4e48eabdf2ec34b3a76ec3046864b041d749c23e8c08609d4828c094`.
Raw answers, source evidence, ratings, plan and key remain ignored under
`ml/out/context_factorial/` and must not be committed.

**Next:** refine excerpt selection with the original prompt, focusing on a
smaller set of relevant, complementary evidence and the packing-only failure
cases, then recheck on TRAIN under a separately fixed/approved workload.
Preserved cached context pools can support that development without reopening
frozen questions. Do not start another model run, change live defaults or
resume the remaining frozen answers under this completed authorization.
