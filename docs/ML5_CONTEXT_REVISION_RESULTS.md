# TRAIN context selection and citation comparison — October 18, 2026

**Completed; hold the revision.** The approved twenty-answer TRAIN comparison
was faster with selected excerpts, but correctness and citation grounding
worsened. The predeclared regression gate failed. Live settings and the frozen
retrieval decision remain unchanged; frozen generation remains paused at
12/100. No manual grading is required from Aditya for this TRAIN comparison.

The fixed source-sealed design is in `docs/ML5_CONTEXT_REVISION.md`. Ten TRAIN
questions cover four PDFs: six previously reviewed development cases, two new
answerable cases and two synthetic unsupported probes. The larger comparator
uses the original prompt and eight contexts / 18K text bytes. The revision
combines query-aware excerpts (up to six sources / 4K bytes) with a source-only
grounding prompt. Both interventions changed together; this experiment cannot
separate their individual effects.

## Quality and decision

The assistant reviewed all twenty answers against their supplied excerpts
and references, saved complete opaque-ID ratings, then the scorer wrote a
hash receipt before opening the private method key. The report title is
neutral; methodology records the assistant reviewer and absence of human
validation. Prior-case familiarity, common question authorship and visible
context differences limit independence and blinding. Ratings were not edited
after unblinding. Scores use the existing 0–2 rubric.

| Score | Larger/original mean [95% CI] | Selected/grounded mean [95% CI] | Paired revision minus larger [95% CI] | Paired regressions |
| --- | --- | --- | --- | ---: |
| Correctness | 1.800 [1.455, 2.000] | 1.500 [1.167, 1.875] | -0.300 [-0.444, -0.111] | 3/10 |
| Grounding | 1.800 [1.455, 2.000] | 1.400 [1.091, 1.778] | -0.400 [-0.600, -0.125] | 4/10 |

Intervals resample entire documents using the unchanged 2,000-resample
bootstrap. Only four document clusters, selected development questions and
one reviewer make these exploratory. Although the paired intervals exclude
zero in this sample, they do not establish a general population effect or a
production-quality estimate. Numerical scores depend on the documented
subjective judgments, including partial credit for a muddled definition.

| Cohort | Questions | Correctness, larger → revision | Grounding, larger → revision |
| --- | ---: | --- | --- |
| Prior development cases | 6 | 1.667 → 1.500 | 1.667 → 1.333 |
| New answerable cases | 2 | 2.000 → 1.000 | 2.000 → 1.000 |
| Synthetic unsupported probes | 2 | 2.000 → 2.000 | 2.000 → 2.000 |

Both variants correctly abstained on **2/2 unsupported probes**. Their bootstrap
intervals are degenerate [1, 1] because both observations succeeded; this is
not evidence of a reliable false-answer rate. The reference audit retained
every required quote for **8/8 answerable questions** in raw retrieval and
both variants. No reference loss explains these generated-answer regressions.

Failure review found unnecessary refusal despite supplied evidence, an
inaccurate supporting quotation, substitution of a citation label for a
requested numeric value, and a muddled/reversed definition relation. One
comparison question remained an unjustified refusal under both variants.
All citation numbers were within range, showing why syntax checks cannot
stand in for semantic support. No failed answer was repaired or regenerated.

Correct facts with inaccurate source attribution retain correctness but lose
grounding credit. A contradictory refusal followed by an actual supported
answer receives partial credit and is treated as a mixed answer, rather than
a complete abstention. Refusing the requested comparison despite both
definitions receives zero. Redundant related citation labels alone are not
penalized when a cited excerpt supports every substantive claim. Complete
per-answer rationales remain private.

## Timing and integrity

Exactly twenty requests completed, with **no failures, retries or 512-token
length stops**. Active retrieval/generation took **20m 13s**: approximately
3m 58s preparation/retrieval and 16m 14s generation. Resource settings stayed
at three CPU threads, zero GPU, 32K context and temperature 0.1, with the same
model digest and Ollama 0.40.4. The assistant did not start Ollama.

| Mean over ten requests per variant | Larger/original | Selected/grounded |
| --- | ---: | ---: |
| First visible text | 63.9 s | 22.7 s |
| Request total | 70.8 s | 26.6 s |
| Server prompt processing | 63.8 s | 21.8 s |
| Server output generation | 6.9 s | 3.9 s |
| Prompt tokens | 1,730.5 | 813.1 |
| Output tokens | 54.8 | 36.4 |

These selected TRAIN timings have uncontrolled cache/order effects and
different output lengths. They are not representative app latency, an
isolated packing effect or a reason to accept lower answer quality. No live
streaming change is included.

The full model-free Python suite passed **446 tests in 64.38 seconds** before
the run; no implementation source changed afterward. One understood Windows
core-discovery helper warning used its logical-core fallback; all actual
workload thread limits were explicit. Six non-UI grading-parser tests passed
afterward. The actual parser accepted twenty opaque answers, ten unique
questions, canonical packet hash and all saved ratings in Node. No browser
or UI operation was performed.

Recomputed runtime aggregates and paired scores match saved reports. Verified
twenty unique started/complete pairs, complete state, removed generation lock,
plan/journal/packet/key/ratings hashes and **all 22 protected checkpoint files**.
Neither frozen question source was opened, no existing answer was replaced,
no model was fitted and no commit was made.

Public aggregate reports:

- `ml/results/context_revision_train_runtime.json`, SHA-256
  `ed03944e4c520b2417a8491a2830956cf73d2c32ccc6847473a96750f6202da3`.
- `ml/results/context_revision_train.json`, SHA-256
  `a56703616c84934a22a8a917105fb9db3d111a2fd10773584a9e7a2ba895cb62`.

Private study SHA-256:
`a032f48d546562601c72df0c39ced7d775f1d19d90818cf041a69e46bc894108`.
Private ratings SHA-256:
`474792aecccc8d36e5b2186c976e34b8bfbc50aaf9482a2cdbfce3db8cb75cf7`.
Review receipt SHA-256:
`19a5e672b6aa0380a8862afdaed41841d34c46b85774b46653c46080b619eb50`.
Raw answers, evidence, ratings and key remain ignored under
`ml/out/context_revision/` and must not be committed.

**Next:** isolate packing-only versus prompt-only effects using cached TRAIN
contexts, before considering another combined revision. Focus on refusal,
fact extraction and correct evidence-to-citation assignment. A future model
comparison needs a separately fixed plan and CPU approval; this twenty-answer
authorization is consumed. Do not promote this revision or tune on frozen
questions. Continue the remaining ML5.3 frozen generation only when separately
requested and approved.
