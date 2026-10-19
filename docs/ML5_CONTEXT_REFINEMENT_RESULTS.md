# Original-prompt excerpt refinement on TRAIN — October 18, 2026

**Completed: hold the refined selector.** The smaller evidence packets are
promising for latency, but one answer regresses against the fresh full-context
comparator and has worse citation grounding than both comparators. Equal
average correctness does not satisfy the predeclared per-question gate. No
live setting changed. Frozen ML5 generation remains paused at 12/100.

Aditya approved all thirty requests. The source-sealed procedure is in
`docs/ML5_CONTEXT_REFINEMENT.md`; its preparation status is historical. Ten
previously reviewed TRAIN cases / four PDFs received three fresh answers
each: exact full contexts, exact previous excerpts and refined excerpts, all
with the unchanged original QA prompt/system. Previous answers were not
reused. The new selector prioritizes queried definitions, complementary
coverage and qualified whole units, with four-source / 4K text-byte caps and
early stopping. It uses no reference labels or generated answers.

No retrieval, PDF extraction, encoder loading, fitting, frozen-question read
or Ollama startup occurred. The manually running qwen2.5:3b-instruct model
and Ollama 0.40.4 matched their seals. All requests used three CPU threads,
zero GPU, temperature 0.1, 32K allocation and a 512-token cap.

## Quality and decision

The assistant reviewed all thirty opaque outputs against their actual supplied
contexts and references. Complete ratings were saved/validated, then the
scorer wrote a hash receipt before grading-time plan/key disclosure. Ratings
were not edited after disclosure. Methodology records assistant review and
no human validation; no manual grading is pending from Aditya. Visible
context differences, prior question familiarity and shared implementation/
review authorship limit blinding and independence.

| Original-prompt condition | Correctness, 0–2 [95% CI] | Grounding, 0–2 [95% CI] | Mean request time |
| --- | --- | --- | ---: |
| Full contexts | 1.900 [1.727, 2.000] | 1.800 [1.455, 2.000] | 30.8 s |
| Previous excerpts | 1.900 [1.727, 2.000] | 2.000 [2.000, 2.000] | 13.1 s |
| Refined excerpts | 1.900 [1.727, 2.000] | 1.900 [1.727, 2.000] | 5.1 s |

Differences pair answers within questions and resample whole source documents
with the unchanged 2,000-resample bootstrap. Positive means a higher score
for the first-named condition.

| Paired contrast | Correctness difference [95% CI] | Grounding difference [95% CI] |
| --- | --- | --- |
| Refined minus full | 0.000 [-0.273, 0.273] | +0.100 [-0.273, 0.545] |
| Refined minus previous | 0.000 [0.000, 0.000] | -0.100 [-0.273, 0.000] |
| Previous minus full | 0.000 [-0.273, 0.273] | +0.200 [0.000, 0.545] |

| Refined versus comparator | Correctness regressions | Grounding regressions |
| --- | ---: | ---: |
| Full | 1/10 | 1/10 |
| Previous | 0/10 | 1/10 |

Each condition retained all required references for **8/8 answerable cases**
and correctly abstained on **2/2 synthetic unsupported probes**. There were
no additional reference losses or out-of-range citation mentions. Lexical
quote retention did not prevent incomplete answers or incorrect attribution.
The two unsupported probes cannot establish a false-answer-rate guarantee.

The six earlier development cases have correctness 1.833 in every condition;
their grounding is 1.667 full, 2.000 previous and 1.833 refined. The two
later-added answerable cases and both negative probes score 2.000/2.000 in
every condition. The report's legacy `new_answerable` cohort name describes
when those two cases entered the earlier study; they are previously seen here.

Only four document clusters, ten selected cases, one generation per cell,
one reviewer and multiple unadjusted contrasts make these exploratory.
Degenerate intervals reflect identical graded differences in this sample,
not certainty about unseen questions. Equal means do not prove noninferiority,
and the grounding contrast does not establish a population improvement.

## Failure review

The full-context answer to the definition-comparison case gave both correct
definitions but contradicted itself by claiming the distinction was absent.
Its mixed response received partial correctness/grounding rather than being
treated as a complete refusal. Both excerpt conditions answered that case
correctly in this batch. A full-context definition answer also bundled
supporting citations with unrelated pumping-argument sources, losing grounding.

Both excerpt conditions incompletely answered the necessary-versus-sufficient
classification. The previous selector's answer gave a supported insufficiency
statement but omitted the positive necessary-condition classification, scoring
1 correctness / 2 grounding. The refined answer added a supported convex-case
exception, misattributed its first claim and ended with a contradictory refusal,
scoring 1/1. The fresh full-context answer directly classified the conditions
as necessary and scored 2/2. This single question blocks refined acceptance.

The needed statements remain in the refined packet. They are divided between
two sources from the same page; the first source states necessity while the
second carries insufficiency and the convex exception. Fragmentation is a
plausible diagnostic target, not a proven cause: generation noise and model
behavior also matter, and the previous selector is incomplete despite a more
coherent packet. No excerpt was repaired using these observations in this run.

Rubric decisions distinguish incomplete correctness from support for asserted
facts. Accurate page/title attribution was accepted even without bracket-number
syntax. Redundant citations to supporting evidence are cosmetic; unrelated
citations presented with a claim lose grounding. Mixed refusal plus substantive
answer is not recorded as complete abstention. These judgment-sensitive choices
were recorded privately before disclosure and reinforce the review limitation.

## Timing and verification

Thirty unique requests completed in **8m 11s** of active generation, including
about 8m 10s of request time. All attempts completed normally, with no failed,
unresolved, duplicate or retried request and no output length stop.

| Mean per condition (10 requests each) | Full | Previous | Refined |
| --- | ---: | ---: | ---: |
| Context text, UTF-8 bytes | 5,114.5 | 1,978.0 | 377.1 |
| First visible text | 26.4 s | 9.2 s | 1.9 s |
| Request total | 30.8 s | 13.1 s | 5.1 s |
| Server prompt processing | 25.9 s | 9.2 s | 1.8 s |
| Server output generation | 4.4 s | 3.9 s | 3.3 s |
| Prompt tokens | 1,730.5 | 788.8 | 336.5 |
| Output tokens | 57.3 | 57.6 | 51.2 |

These are within-batch descriptive timings, including the two negative probes.
Question-block order was counterbalanced, each condition occupying each slot
three or four times. Cache/carryover, output length and machine load still
affect timing. The comparison excludes retrieval and is not a measured live
end-to-end response guarantee or a cross-run speed claim.

The full model-free suite passed **487 tests in 27.17 seconds, no warnings**
before sealing. No implementation source changed afterward. All six non-UI
parser tests passed after generation started; after review, the actual offline
parser validated thirty opaque answers, ten questions, the packet hash and
all thirty ratings in Node. No browser/UI operation was performed.

Recomputation matches runtime, condition/paired/cohort quality,
abstention and acceptance-gate aggregates. Checks confirmed thirty unique
started/complete pairs, complete state, removed lock, source/model/plan/
journal/packet/key/ratings/receipt hashes and **all 44 protected checkpoint
files**. Final `--check` also passed without loading a model. Prior/frozen
experiments, live defaults and unrelated frontend work are preserved. No
commit was made.

The runtime report is an immutable pre-review snapshot; its
`generation_complete_grading_pending` / `quality_assessed:false` fields refer
to that stage. The separate quality report records the completed review and
hold decision. Do not rewrite the sealed runtime report to change its status.

Public aggregates:

- `ml/results/context_refinement_train_runtime.json`, SHA-256
  `91d4a7513077db117966dff58635888f462694c2c25add811d3cc095b10c9db6`.
- `ml/results/context_refinement_train.json`, SHA-256
  `f6a59b7e525c13b131e3ffb611917ed9863b943669bade7d941250b089383691`.

Private plan file SHA-256:
`1189b03e5ae5a94278b8a267bec487920dd3e96e45fdca15bebeed901d557f67`.
Canonical generation-plan SHA-256:
`16eb97d868e5ecd5b2a7f2e26944bab1cae635c04daf73222cd1717038ef23ad`.
Private ratings SHA-256:
`f27ea1dac8c789035a81b12b6f73df7766b4ba81b5d4fb94c2c602dc7025775f`.
Review receipt SHA-256:
`55601a5d5814238fdad34242f89afaf47713e101de02fa2354134e2309030d9a`.
Raw evidence, answers, ratings, plan and key remain ignored under
`ml/out/context_refinement/` and must not be committed.

**Next:** keep the original prompt and diagnose merging adjacent/overlapping
same-page excerpts into coherent evidence blocks, preserving qualifications
and original within-page text order. Fix a generic comparison before model work, then
validate on a broader TRAIN sample under separate workload approval. Do not
promote this candidate, modify the frozen retrieval decision, start ML6 or
resume the remaining frozen answers under this completed authorization.
