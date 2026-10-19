# Same-page evidence coherence on broader TRAIN — October 18, 2026

**Completed: defer the coherent selector and end this optional tuning cycle.**
The candidate reduced mean generation-request time to 6.3 seconds from 30.2
seconds and improved average grounding, but one correctness regression fails
the fixed acceptance rule. Both conditions also produced wrong mathematical
formulas on a new case. Live defaults remain unchanged. The original frozen
answer study remains at 12/100 generated; this TRAIN work does not complete it.

Aditya approved all 36 requests. The sealed procedure is in
`docs/ML5_CONTEXT_COHERENCE.md`; its preparation status is historical. Eighteen
TRAIN cases cover six PDFs, with two answerable and one synthetic unsupported
question per PDF: four known sentinels, eight new answerable prompts and six
new unsupported probes. New means new to this screen, not independent authorship
or a holdout. Every reference was checked against its native TRAIN page and
each nonce against its entire TRAIN PDF before model work.

Four exact sentinel pools were reused and fourteen fresh queries used actual
hybrid-concepts service retrieval / CE reranking against an in-memory index
of the six TRAIN PDFs. Full top-eight/18K and coherent four-source/4K packets
used the same original QA/system prompts. No original frozen question file
was opened, frozen retrieval repeated, ranker fitted, persistent index replaced
or Ollama started. Earlier answers were protected, not reused as new outputs.
Model/version stayed qwen2.5:3b-instruct / Ollama 0.40.4, with pinned identity,
three CPU threads, zero GPU, temperature 0.1, 32K allocation and 512-token cap.

## Quality

The assistant reviewed all 36 opaque answers against actual supplied contexts
and references, saved/validated every rating, then the scorer wrote a hash
receipt before grading-time study/plan/key disclosure. No ratings were changed
after disclosure. Metadata records assistant review and no human validation;
no manual grading is pending from Aditya. Prior familiarity, common authorship
and visibly different context lengths limit blinding and independence.

| All 18 cases, 0–2 scale | Full [95% CI] | Coherent [95% CI] | Coherent minus full [95% CI] |
| --- | --- | --- | --- |
| Correctness | 1.833 [1.611, 2.000] | 1.833 [1.611, 2.000] | 0.000 [-0.167, 0.167] |
| Grounding | 1.778 [1.556, 1.944] | 1.889 [1.667, 2.000] | +0.111 [0.000, 0.222] |

| Twelve answerable cases only | Full [95% CI] | Coherent [95% CI] | Coherent minus full [95% CI] |
| --- | --- | --- | --- |
| Correctness | 1.750 [1.417, 2.000] | 1.750 [1.417, 2.000] | 0.000 [-0.250, 0.250] |
| Grounding | 1.667 [1.333, 1.917] | 1.833 [1.500, 2.000] | +0.167 [0.000, 0.333] |

The coherent candidate has **one correctness regression and zero grounding
regressions** versus fresh full context. Both conditions correctly refused
all **6/6 synthetic unsupported probes**, with no fabricated codes. This
small synthetic denominator and degenerate [1, 1] bootstrap interval do not
establish a false-answer-rate guarantee.

| Cohort | Cases / PDFs | Correctness full / coherent | Grounding full / coherent |
| --- | --- | --- | --- |
| Known sentinels | 4 / 4 | 1.750 / 1.750 | 1.750 / 2.000 |
| New answerable prompts | 8 / 6 | 1.750 / 1.750 | 1.625 / 1.750 |
| Synthetic unsupported probes | 6 / 6 | 2.000 / 2.000 | 2.000 / 2.000 |

Among new answerable prompts, the paired correctness difference is 0.000
[0.000, 0.000] and grounding +0.125 [0.000, 0.429]. Known-sentinel paired
differences are correctness 0.000 [-0.750, 0.750] and grounding +0.250
[0.000, 0.750]. Full condition/cohort intervals are in the aggregate JSON.
All intervals use the unchanged 2,000-resample whole-document bootstrap;
six document clusters, single outputs per condition and unadjusted contrasts
make them exploratory. Equal means do not prove equivalence/noninferiority;
grounding intervals touching zero do not establish a population gain.

## Evidence and failure review

The necessary-versus-sufficient sentinel still regressed in correctness. The
merged packet contains the necessary statement, general insufficiency and
convex exception together in correct source order, but the model returned only
the insufficiency statement. That is supported but incompletely classifies
the conditions: 1 correctness / 2 grounding versus full's 2/2. Consolidation
removed the earlier source-attribution issue without fixing the incomplete
answer in this generation. No causal cure or generalization claim follows.

The full-context definition-comparison answer gave accurate definitions but
contradicted itself with a false absence claim; it received 1/1 as a mixed
answer, not a complete abstention. The coherent answer gave the correct
distinction and scored 2/2. Those offsets explain equal average correctness.
A full-context pruning answer added a true training/test distinction but
cited a source that only established training/validation separation; the
uncited supporting statement was elsewhere in its pool. That lost grounding,
consistent with evaluating actual attribution separately from factual truth.

The new condition-number case failed in both conditions: both generated
incorrect eigenvalue and norm expressions. The selected concept text has
garbled mathematical order/superscripts; a clearer relation also appears in
the full packet, but its answer remains wrong. This identifies a limitation
of structured-math extraction and model reconstruction. No excerpt repair,
formula rewriting, extra trial or case exclusion was performed. Incidental
correct eigenvalue names do not rescue an incorrect central expression.

Complete native-reference matches were **8/12** in raw retrieval, full and
coherent packets alike, with **zero additional losses** from either packing
stage. All four misses are new cases: pruning, protocol definition, cable
access and condition number. Native line extraction and the service's word/
column/concept assembly differ in order, bullets or mathematical layout;
literal mismatch is not itself proof of absent semantic evidence. Three
of these questions were answered factually correctly using relevant supplied
text despite the failed exact-match audit; the math question was not. Retain
all misses and report them instead of inflating the audit to 12/12 or changing
gold after seeing results. No out-of-range citation mention occurred.

The rubric accepts concise source-supported explanations without requiring
every clause of a reference. It penalizes false absence claims and incomplete
requested classifications. Facts correct elsewhere in the pool can retain
correctness while losing grounding for inappropriate citation. These judgments
were fixed before disclosure; single-reviewer sensitivity remains a limitation.

## Runtime and verification

Indexing/retrieval plus generation took **12m 59s** from the durable retrieval
start marker to complete generation state; generation itself took **10m 58s**,
including about 10m 58s of request time. All 36 unique attempts completed with
no failed, unresolved, duplicate or retried request and no output length stop.
The total excludes study preparation, tests and grading.

| Mean per condition (18 requests each) | Full | Coherent |
| --- | ---: | ---: |
| First visible text | 24.9 s | 2.2 s |
| Request total | 30.2 s | 6.3 s |
| Server prompt processing | 24.8 s | 2.2 s |
| Server output generation | 5.3 s | 4.1 s |
| Prompt tokens | 1,580.4 | 348.2 |
| Output tokens | 63.9 | 54.0 |

These descriptive within-batch timings include all six negative probes and
exclude per-request retrieval. Nine blocks ran each condition first; cache,
carryover, output length and machine load still affect timing. They are not
live end-to-end latency guarantees or evidence that the remaining original
frozen prompts will run this quickly.

The full model-free Python suite passed **511 tests in 30.76 s, no warnings**
before sealing; no implementation source changed afterward. Six parser tests
passed after review. The actual offline parser verified all 36 opaque answers,
18 questions, packet hash and complete saved ratings in Node; no UI operation.
Recomputed runtime, paired/cohort/answerability metrics, abstentions and gate
match the reports. Verified 36 started/complete pairs, complete state, removed
generation lock, source/model/study/plan/journal/packet/key/ratings/receipt
hashes and **all 54 protected checkpoint/report files**. Original frozen
generation remains exactly 12/100. No commit or live change was made.

The runtime report is an immutable pre-review snapshot with grading pending;
the separate quality report records completed review and the defer decision.
Public outputs:

- `ml/results/context_coherence_train_runtime.json`, SHA-256
  `ffc86fdc764f5454a597bed14cc43993b05f62c6e6b6a8119f5cb149ba83f404`.
- `ml/results/context_coherence_train.json`, SHA-256
  `46f167fa1be8e8c8d9b0e0d8cd899cb88d798ab3f4a295394ee6f3274a5f3f2d`.

Private study file SHA-256:
`0a6810478394eeb96205dd4cfe09b9680927b3eb993a2496ac400dfb73c70930`.
Private generation-plan file SHA-256:
`71ce44f17fd059d9917f7bf899f6deacb2f3812ccd8a2b03aa2d2f31f9808e80`.
Canonical generation-plan SHA-256:
`81487c75b7db9c45dd75cf5795de1d7f5e07bd0444587459288ea3becc32fe19`.
Private ratings SHA-256:
`f9cb5d1faea4d5b10f113cefd9afc8249c7e055a5aba9ca083b35af580d7ef7d`.
Review receipt SHA-256:
`53158da1125155e352f6e5e371c90d67e3beac6e72310f95f10169b5bfd4bdd8`.
Raw evidence/answers/ratings/keys remain ignored under `ml/out/context_coherence/`.

**Next: original ML5 closeout, with no further automatic context tuning.**
ML5.1 and ML5.2 are complete. The original ML5.3 still needs 88 frozen answers
generated, all 100 reviewed, and ML5.4 synthesis. Remaining generation is
roughly four hours at its last measured mean, followed by review/reporting;
it needs separate workload approval and the existing sealed prompts/settings.
Do not apply this faster candidate to rewrite that experiment. If Aditya
prefers to defer the expensive answer study, explicitly record it as incomplete
before producing a limited closeout; do not silently call the full ML5 protocol
complete. No further model run is authorized by this completed comparison.
