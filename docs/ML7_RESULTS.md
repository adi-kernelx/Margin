# Margin ML results and final write-up

October 19, 2026. ML1–ML5 implemented and measured; ML7 write-up complete.
ML6 answerability calibration remains optional and unimplemented. The default
is hybrid + OKF concepts + cross-encoder. Learned reranking, link expansion
and context experiments have no demonstrated basis for a default switch.

This is a synthesis of saved evidence, not a new benchmark. Separate block
roles, concept extraction, retrieval, answer quality and latency; their
denominators and supervision differ. The [model card](MODEL_CARD.md) and
[dataset card](DATASET_CARD.md) describe mechanisms and provenance.

## Block understanding

The final OKF pipeline combines heading rules, a trained sentence detector
and source-weighted stacked classification. Its adjudicated 300-block/12-PDF
sample is enriched, AI-annotated and repeatedly evaluated. Results are
diagnostic rather than population accuracy or independent human validation.

| Pipeline / diagnostic metric | Estimate [95% document CI] |
|---|---|
| Role accuracy | 0.730 [0.653, 0.804] |
| Macro F1, five substantive classes | 0.723 [0.595, 0.773] |
| Contains-definition precision, all 300 blocks | 0.877 [0.794, 0.959] |
| Contains-definition recall, all 300 blocks | 0.475 [0.383, 0.561] |
| Detector precision, 200 unheaded blocks | 0.864 [0.781, 0.952] |
| Detector recall, 200 unheaded blocks | 0.560 [0.415, 0.699] |

Source: `ml/results/gold_ml215_pipeline_adjudicated.json`. Both models were
re-scored against adjudicated labels; no new untouched test follows. Earlier
weak-label CV scores are development evidence and should not replace this
diagnostic row or be presented as general PDF accuracy.

## OKF bundles, titles and links

Final build: 48/48 main PDFs conformant, 1,188 concepts and 1,591 links.
Conformance checks format/structure, not factual correctness. Title rules
were developed on one item sample, then checked on held-out items over 32
PDFs. This is item-held-out, not a claim of source-disjoint evaluation.

| OKF metric | First held-out read [95% CI] | Post-fix final build [95% CI] |
|---|---|---|
| Concept precision | 0.929 [0.857, 0.978] (n=85) | 0.938 [0.870, 0.988] (n=81) |
| Title good | 0.747 [0.620, 0.861] (n=79) | 0.776 [0.662, 0.882] (n=76) |
| Title usable | 0.924 [0.857, 0.976] (n=79) | 0.921 [0.846, 0.976] (n=76) |
| Link precision | 0.756 [0.561, 0.943] (n=41) | 0.811 [0.628, 0.971] (n=37) |

Sources: `ml/results/okf_gold_test.json`, `okf_gold_test_final.json` and
`okf_bundles_summary.json`. Two exposed issues were repaired after the first
held-out read; keep the first-read estimate for an honest held-out claim.
Dropped concepts/links change the final denominators. Single-assistant labels
and the precision/coverage tradeoff limit these findings.

## Frozen retrieval

One authorized inference-only milestone, 80 original and 78 independent cases:
65/62 answerable, 15/16 unsupported. Both answerable collections share six PDFs.
Intervals below resample complete PDFs, 2,000 draws, seed 20261006. Metrics
weight questions equally and exclude unsupported cases. Page nDCG gives gain
only at the first occurrence of each gold page, retaining candidate ranks;
its ideal denominator includes missing gold pages. Training labels differ.

| Collection / method | Recall@5 [95% CI] | MRR@10 [95% CI] | nDCG@10 [95% CI] |
|---|---|---|---|
| Original / cross_encoder | 0.9231 [0.8750, 0.9697] | 0.8213 [0.7257, 0.9214] | 0.8385 [0.7631, 0.9206] |
| Original / ranker_full | 0.9846 [0.9538, 1.0000] | 0.8454 [0.7576, 0.9242] | 0.8627 [0.7961, 0.9256] |
| Independent / cross_encoder | 0.9839 [0.9508, 1.0000] | 0.8414 [0.7904, 0.9014] | 0.8638 [0.8232, 0.9100] |
| Independent / ranker_full | 1.0000 [1.0000, 1.0000] | 0.8102 [0.7654, 0.8680] | 0.8472 [0.8125, 0.8857] |
| Pooled / cross_encoder | 0.9528 [0.9302, 0.9762] | 0.8311 [0.7716, 0.8905] | 0.8509 [0.8019, 0.8966] |
| Pooled / ranker_full | 0.9921 [0.9767, 1.0000] | 0.8282 [0.7700, 0.8925] | 0.8551 [0.8079, 0.9036] |

Primary ranker-minus-CE pooled MRR: **-0.0029 [-0.0551, +0.0385]**.
Independent MRR/nDCG point differences are negative. The fixed default-switch
rule fails despite higher Recall@5; retain CE. Exact pooled Recall McNemar
p=0.0625 (zero lost, five gained) is supporting evidence only because questions
within PDFs depend on one another. No seed has a positive pooled MRR difference.

Matched concepts-on minus passages-only CE MRR: **+0.0370 [+0.0040, +0.0742]**.
Keep concepts enabled on this evidence; not every metric improves. Ranker
concept MRR benefit is uncertain, and links show no pooled gain. Feature-group
removals/type breakdowns remain descriptive, with no post-test selection.
All 15 frozen ablation variants, seed checks and paired intervals are in the
[ML5 synthesis and decision log](ML5_SYNTHESIS.md), with original/independent
counts kept separate. Do not reinterpret independent wording as new documents.

## Generated-answer quality and latency

Fifty fixed questions/six PDFs, 100 outputs: both methods answer 20 positive
and five unsupported questions per collection. All ratings were saved before
grading-time key disclosure. One assistant reviewer, partial blinding and no
independent human validation; 0–2 score means are not accuracy percentages.

| Answer-review sample | CE correctness | Ranker correctness | Difference [95% CI] | CE grounding | Ranker grounding | Difference [95% CI] |
|---|---:|---:|---|---:|---:|---|
| Original | 1.800 | 1.760 | -0.040 [-0.211, 0.125] | 1.440 | 1.560 | 0.120 [-0.091, 0.423] |
| Independent | 1.720 | 1.840 | 0.120 [-0.182, 0.400] | 1.560 | 1.600 | 0.040 [-0.095, 0.154] |
| Pooled | 1.760 | 1.800 | 0.040 [-0.200, 0.275] | 1.500 | 1.580 | 0.080 [-0.067, 0.267] |

Both methods have zero unwanted answerable abstentions and 9/10 correct
unsupported refusals (90%, CI [72.7%, 100%]); one qualified refusal adds
speculation. Correctness/grounding difference intervals include zero. Wrong
facts, mathematics, units/table columns, incomplete definitions and citation
misattribution remain. The trained ranker does not train or repair the Qwen LLM.

Successful frozen-generation mean/median 136.7/117.9 s per request, range
28.9–396.8 s. Original twelve outputs retained, 88 added; two interrupted
requests/two administrative retries preserved. Threads vary 2/36/62 outputs
at two/three/four threads. Final seventy use fresh workers/model unloading.
Final-stage peak sampled RAM 79.67%, threshold 85%; model CPU ceiling 50%,
whole-laptop CPU peak 100%. No global CPU cap, hardware-fault assurance or
controlled method-speed comparison follows from these mixed conditions.

The last exploratory TRAIN coherence screen reduced mean requests 30.2 ->
6.3 s and first visible text 24.9 -> 2.2 s, excluding per-request retrieval.
It had one correctness regression despite equal mean correctness, so the
selector stays deferred. Neither study establishes interactive end-to-end
latency. See [ML5.3 completion](ML53_COMPLETION_RESULTS.md) for full provenance.

## Cross-phase decision log

| Decision | Evidence / remaining limit |
|---|---|
| Keep the frozen OKF pipeline | Useful structured concepts; noisy weak labels, missed definitions and title/link errors remain |
| Keep hybrid + concepts + CE | Positive concept MRR ablation; ranker fails fixed primary switch rule |
| Retain ranker/links as opt-in | No test-guided seed, feature or routing change |
| Hold prompt/context changes | TRAIN correctness regressions; speed does not establish quality preservation |
| Leave ML6 optional and unimplemented | Current similarity confidence is uncalibrated; no guaranteed false-answer rate |
| Preserve local data boundary | Raw text, questions, model vocabulary and outputs remain excluded from commits |
| Close ML7 documentation | No new model work or test-set read; deployment acceptance is separate |

## Verification, reproduction and next work

The ML5 checkpoint is `30be3a0` (Complete ML5 answer evaluation and final
synthesis). ML7 documents existing results. Exact aggregate, source and
artifact hashes plus documentation checks are in `ml/results/ml7_documentation.json`.
The preceding full model-free suite passed 532 Python tests and six grading
session tests; it recorded one investigated missing-`wmic` core-count warning.
ML7 checks local Markdown links, commands/source defaults, metric tables and
input hashes. No UI acceptance or model-backed evaluation was repeated.

Completed ML7 checks: **25 input hashes, 25 numerical table rows and 24 local
Markdown links** validate. Documented npm scripts, dependency paths, API entry
points, model/retrieval defaults and artifact identities match source. The
ML5.3 completion verifier still validates all 100 outputs and 64 immutable
checkpoints. Three unrelated frontend/plan files remain byte-identical to
their pre-commit state; the authorized local project summary was rewritten.
`git diff --check` passes. The 532-test ML suite was not rerun for these
documentation-only edits; its tested implementation is unchanged.

Model artifacts/PDFs/quoted labels/questions are not distributed with the
repository, so historical training/inference is not reproducible from code
alone. Existing frozen tests are consumed; saved aggregates are the supported
verification route. New claims require new validation data and a plan.

The user subsequently requested the ML7 documentation checkpoint.
**Next:** remaining product work is the earlier manual reader/chrome acceptance and optional
static-demo publication. A calibrated ML6 gate or latency/grounding engineering
would be a separate requested phase; do not start another tuning cycle here.
