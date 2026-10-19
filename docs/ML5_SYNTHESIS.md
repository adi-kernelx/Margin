# ML5 final synthesis and decision log

Completed October 19, 2026. **ML5.1–ML5.4 are complete. Keep hybrid retrieval
with OKF concepts and the cross-encoder.** The learned ranker remains an
opt-in experiment; link expansion stays opt-in; context/prompt experiments
remain deferred. Completion records the measured outcome, including failures
to improve the baseline. It does not establish deployment readiness.

This synthesis uses saved aggregate reports only: no model call, frozen
question-file read, retrieval, answer regrading or live setting change.

The trained model in this comparison is the LambdaRank reranker. The local
Qwen LLM that generated answers is pretrained; ML5 did not train or fine-tune
it. Retrieval quality, generated-answer quality and response latency are
separate outcomes.

## Evidence and primary decision

| Subphase | Completed evidence | Status |
|---|---|---|
| ML5.1 | 15 TRAIN ablation variants; three seeds; frozen artifact/protocol | Complete |
| ML5.2 | Single authorized frozen retrieval milestone; both collections; statistics and type breakdowns | Complete |
| ML5.3 | 100 generated and assistant-reviewed answers; sealed ratings; integrity verification | Complete under delegated-review amendment |
| ML5.4 | Existing-result synthesis, OKF verdict and final decision log | Complete |

TRAIN: 120 questions, 95 answerable over nine PDFs, 25 unsupported. Retrieval
uses leave-one-document-out and the mean of seeds 0/1/2. Frozen retrieval:
80 original (65 answerable/15 unsupported) plus 78 independent (62/16).
Both answerable TEST collections share six PDFs; pooled uncertainty uses six
clusters, not twelve. Answer review covers a fixed subset of 50 questions,
40 answerable/10 unsupported, with two answers each.

The original questions were AI-authored after retrieval development; the
independent collection was authored blind by another AI. Neither collection
is human-authored validation, and independent wording does not supply new
source-document clusters. The fixed answer subset is small and is not a
representative sample of future user traffic. Independent CE MRR was higher
than original CE MRR; lower lexical overlap did not make it uniformly harder.

All intervals are 95% whole-document percentile bootstrap intervals, 2,000
resamples, seed 20261006. Means weight questions equally. Pooled resampling
keeps both question collections from the same PDF together.

| Retrieval sample / method | Recall@5 [95% CI] | MRR@10 [95% CI] | Page nDCG@10 [95% CI] |
|---|---|---|---|
| TRAIN seed mean / cross_encoder | 0.9263 [0.8812, 0.9778] | 0.7872 [0.7127, 0.8667] | 0.8220 [0.7502, 0.8930] |
| TRAIN seed mean / ranker_full | 0.9614 [0.9236, 1.0000] | 0.8119 [0.7435, 0.8838] | 0.8383 [0.7720, 0.9057] |
| Original TEST / cross_encoder | 0.9231 [0.8750, 0.9697] | 0.8213 [0.7257, 0.9214] | 0.8385 [0.7631, 0.9206] |
| Original TEST / ranker_full | 0.9846 [0.9538, 1.0000] | 0.8454 [0.7576, 0.9242] | 0.8627 [0.7961, 0.9256] |
| Independent TEST / cross_encoder | 0.9839 [0.9508, 1.0000] | 0.8414 [0.7904, 0.9014] | 0.8638 [0.8232, 0.9100] |
| Independent TEST / ranker_full | 1.0000 [1.0000, 1.0000] | 0.8102 [0.7654, 0.8680] | 0.8472 [0.8125, 0.8857] |
| Pooled TEST / cross_encoder | 0.9528 [0.9302, 0.9762] | 0.8311 [0.7716, 0.8905] | 0.8509 [0.8019, 0.8966] |
| Pooled TEST / ranker_full | 0.9921 [0.9767, 1.0000] | 0.8282 [0.7700, 0.8925] | 0.8551 [0.8079, 0.9036] |

| Ranker minus CE | Recall@5 difference | MRR@10 difference | nDCG@10 difference |
|---|---|---|---|
| TRAIN seed mean | +0.0351 [-0.0181, +0.0842] | +0.0246 [-0.0014, +0.0506] | +0.0163 [-0.0014, +0.0335] |
| Original TEST | +0.0615 [+0.0303, +0.0938] | +0.0241 [-0.0398, +0.0841] | +0.0242 [-0.0230, +0.0756] |
| Independent TEST | +0.0161 [+0.0000, +0.0492] | -0.0312 [-0.0866, +0.0115] | -0.0167 [-0.0631, +0.0253] |
| Pooled TEST | +0.0394 [+0.0236, +0.0476] | -0.0029 [-0.0551, +0.0385] | +0.0042 [-0.0364, +0.0375] |

The frozen primary is the original ML4 seed-0 artifact, fixed before TEST.
The preregistered switch requires all three checks:

| Check | Result |
|---|---|
| Strictly positive pooled paired MRR lower bound | Fail |
| Nonnegative MRR and nDCG point differences in each collection | Fail |
| Pooled Recall difference lower bound at least -0.02 | Pass |

**Do not promote the ranker.** Higher Recall@5 does not imply better ordering
of the first answer page. The independent collection has negative MRR/nDCG
point differences. None of the three frozen ranker seeds has positive pooled
MRR difference; no best-seed or post-test query-type routing is selected.

| Exact Recall McNemar, supporting only | Lost | Gained | Two-sided p |
|---|---:|---:|---:|
| Original | 0 | 4 | 0.1250 |
| Independent | 0 | 1 | 1.0000 |
| Pooled | 0 | 5 | 0.0625 |

Question outcomes within PDFs are dependent; these exact tests do not
replace the document-cluster decision rule.

## Ablations and OKF verdict

All 15 variants were frozen before TEST. Pooled seed-0 values below retain
the primary artifact; the final column compares each variant with CE.

| Variant | Recall@5 | MRR@10 | nDCG@10 | MRR vs CE [95% CI] |
|---|---:|---:|---:|---|
| fused | 0.9528 | 0.7482 | 0.7868 | -0.0829 [-0.1493, -0.0095] |
| fused_passages | 0.9370 | 0.6851 | 0.7416 | -0.1460 [-0.2553, -0.0514] |
| fused_links | 0.9528 | 0.7482 | 0.7868 | -0.0829 [-0.1493, -0.0095] |
| cross_encoder | 0.9528 | 0.8311 | 0.8509 | +0.0000 [+0.0000, +0.0000] |
| ce_passages | 0.9606 | 0.7941 | 0.8271 | -0.0370 [-0.0742, -0.0040] |
| ce_links | 0.9528 | 0.8311 | 0.8509 | +0.0000 [+0.0000, +0.0000] |
| ranker_full | 0.9921 | 0.8282 | 0.8551 | -0.0029 [-0.0551, +0.0385] |
| ranker_passages | 0.9685 | 0.7936 | 0.8267 | -0.0375 [-0.1110, +0.0187] |
| ranker_links | 0.9843 | 0.8281 | 0.8518 | -0.0030 [-0.0557, +0.0470] |
| without_ce | 0.9606 | 0.7824 | 0.8222 | -0.0487 [-0.1212, +0.0137] |
| without_lexical | 0.9764 | 0.8192 | 0.8442 | -0.0119 [-0.0656, +0.0437] |
| without_dense | 0.9764 | 0.8235 | 0.8504 | -0.0076 [-0.0532, +0.0285] |
| without_concept | 0.9764 | 0.8181 | 0.8485 | -0.0130 [-0.0855, +0.0513] |
| without_context | 0.9764 | 0.7891 | 0.8286 | -0.0420 [-0.0928, +0.0061] |
| without_fusion | 0.9606 | 0.8179 | 0.8499 | -0.0132 [-0.0850, +0.0498] |

| Matched ablation, pooled TEST | MRR difference [95% CI] |
|---|---|
| concepts_ce_on_minus_off | +0.0370 [+0.0040, +0.0742] |
| concepts_ranker_on_minus_off | +0.0346 [-0.0126, +0.1023] |
| links_ce_on_minus_off | +0.0000 [+0.0000, +0.0000] |
| links_ranker_on_minus_off | -0.0001 [-0.0343, +0.0235] |
| without_ce_minus_full | -0.0458 [-0.0853, -0.0148] |
| without_lexical_minus_full | -0.0090 [-0.0368, +0.0198] |
| without_dense_minus_full | -0.0047 [-0.0228, +0.0197] |
| without_concept_minus_full | -0.0101 [-0.0534, +0.0243] |
| without_context_minus_full | -0.0391 [-0.0746, -0.0076] |
| without_fusion_minus_full | -0.0103 [-0.0364, +0.0141] |

**OKF verdict:** adding concept candidates improves pooled CE MRR on these
six PDFs; it does not improve every metric (pooled CE Recall is slightly
lower), establish a universal benefit, or demonstrate an answer-quality gain
from OKF alone. Concepts under the ranker have an uncertain MRR difference.
Keep concepts enabled. Link expansion has no demonstrated pooled gain.

CE and context feature removals reduce pooled ranker MRR in the descriptive
matched comparisons. Other feature-group intervals include zero. Features
are correlated, comparisons are unadjusted, and the verified flag is zero
throughout the training bundles; these are not causal feature-importance
claims. Do not redesign or refit the primary using these TEST findings.

| Descriptive pooled stratum | Questions | CE MRR | Ranker MRR | Difference [95% CI] |
|---|---:|---:|---:|---|
| definition_dependent | 43 | 0.7810 | 0.8419 | +0.0609 [+0.0246, +0.1052] |
| other | 84 | 0.8568 | 0.8212 | -0.0355 [-0.1050, +0.0283] |

Annotated question type is not a query-time feature. This breakdown is
descriptive; it does not authorize a type-specific production routing rule.

## Answer quality

All 100 opaque answers were reviewed against supplied contexts/references.
Complete ratings and a receipt were sealed before grading-time method/key
disclosure. One assistant reviewer, partial blinding and no independent human
validation limit the result. Scores are means out of two, not accuracy rates.

| Sample | CE correctness | Ranker correctness | Difference [95% CI] | CE grounding | Ranker grounding | Difference [95% CI] |
|---|---:|---:|---|---:|---:|---|
| Original | 1.800 | 1.760 | -0.040 [-0.211, +0.125] | 1.440 | 1.560 | +0.120 [-0.091, +0.423] |
| Independent | 1.720 | 1.840 | +0.120 [-0.182, +0.400] | 1.560 | 1.600 | +0.040 [-0.095, +0.154] |
| Pooled | 1.760 | 1.800 | +0.040 [-0.200, +0.275] | 1.500 | 1.580 | +0.080 [-0.067, +0.267] |
| Answerable | 1.725 | 1.775 | +0.050 [-0.244, +0.343] | 1.400 | 1.500 | +0.100 [-0.077, +0.333] |
| Unsupported | 1.900 | 1.900 | +0.000 [+0.000, +0.000] | 1.900 | 1.900 | +0.000 [+0.000, +0.000] |

No paired correctness/grounding interval establishes an improvement.
Both methods have zero answerable abstentions and 9/10 correct refusals of
unsupported questions (90%, CI [72.7%, 100%]); one qualified refusal per
method adds unsupported speculation. Original: 4/5, independent: 5/5.
Retrieval and answer-review populations differ; the 50-question subset is
not a second evaluation of all 158 retrieval questions.

Remaining failures include incorrect mathematical/security claims, units or
table-column errors, incomplete definitions and unsupported additions.
Citation defects include missing attribution, wrong source markers and
bibliography numbers confused with supplied-context IDs. Source extraction
and reference wording ambiguities remain; no output/reference was repaired
or excluded after inspection. These findings identify limits, not a new
test-guided tuning plan.

## Latency and optional TRAIN work

The latency probe and five quality/tuning screens are additional TRAIN-only
development studies. Their overlapping/reused questions, common authorship,
one generation per condition and exploratory comparisons do not form an
independent holdout. The factorial separated packing and prompting; neither
the revised prompt nor the context variants met adoption requirements.

| TRAIN screen | Cases / PDFs | Final recorded decision |
|---|---|---|
| Bounded context quality | 6 / 3 | Hold: paired correctness/grounding regression |
| Selection plus citation prompt | 10 / 4 | Hold revision: lower correctness and grounding |
| Packing/prompt factorial | 10 / 4 | Diagnostic only; no candidate adoption |
| Original-prompt excerpt refinement | 10 / 4 | Hold: correctness/grounding regressions despite equal correctness means |
| Broader same-page coherence | 18 / 6 | Defer: one correctness regression |

These case counts overlap and must not be added as independent questions.

The last broader screen used 18 cases/six TRAIN PDFs/36 answers. Coherent
blocks matched mean correctness (1.833 vs 1.833) and increased mean grounding
(1.889 vs 1.778; paired +0.111 [0.000, 0.222]), but one correctness regression
failed its fixed gate. Both conditions also produced an incorrect central
mathematical formula. **Defer the selector and stop the optional tuning cycle.**
Its mean request time fell from 30.2 s to 6.3 s, first visible text from
24.9 s to 2.2 s; these exclude per-request retrieval and do not prove
end-to-end production latency or preserved answer quality.

The completed frozen study has successful-request mean/median 136.7/117.9 s,
range 28.9–396.8 s. It retained the first twelve outputs and added 88. Two
administrative interruptions and retries remain recorded. Successful thread
counts are 2/36/62 at two/three/four threads; the final seventy requests used
fresh workers and model unloading after every answer. Mixed load/cache/day/
thread conditions prevent controlled speed comparisons. CPU-only generation
is still too slow here to claim an acceptable interactive experience.

Final 62-worker RAM peaked at 79.67% with an 85% sampled stop threshold.
The model had a 50% logical-CPU affinity ceiling, but total-laptop CPU
samples reached 100%; no global 50% CPU cap was achieved. Resource guards
are not guarantees against thermal/power faults. The model was unloaded.

## Final decision log

| Area | Decision | Reason |
|---|---|---|
| Default retrieval | Keep hybrid + concepts + cross-encoder | Ranker fails fixed MRR/per-set switch conditions |
| Learned ranker | Retain frozen opt-in artifact | Recall gain; no demonstrated primary MRR or answer-quality gain |
| OKF concepts | Keep enabled | Positive pooled CE MRR ablation; limited to studied PDFs |
| Link expansion | Leave opt-in | No pooled gain |
| Feature groups / seeds / type routing | Keep frozen configuration | No post-test selection or redesign |
| Prompt and context selector | Keep original prompt; defer candidates | TRAIN correctness regressions; equal means are not equivalence |
| Answer reliability | Record unresolved facts/citations/math limits | 100 reviewed outputs do not establish deployment readiness |
| Resource operation | Keep measured provenance and explicit workload approval | 85% sampled RAM guard; model-only 50% CPU ceiling |
| Phase status | ML5 complete | Ablations, frozen milestone, delegated answer review and synthesis complete |

## Verification and artifacts

`ml/results/ml5_closeout.json` contains exact copied metrics, the independently
recomputed switch checks, study decisions and SHA-256 input provenance.
Tables were rendered from saved aggregate JSON values, without inference.
Historical phase reports/protocols remain unchanged, including their earlier
pending-status statements; this document and the roadmap/log are current.

Verification on October 19:

- **532 Python tests passed in 78.02 s**, zero failed/skipped. CPU-library
  thread limits were two. One joblib/loky warning reports a missing `wmic`
  physical-core query and fallback to logical cores; it was investigated,
  retained and not suppressed. No experiment result depends on that query.
- The initial restricted run and a diagnostic run were stopped after a
  Windows asyncio internal socket-pair stall before the stub API handler.
  The complete successful rerun used local socket permissions, without a
  model or external service. This was a test-environment limitation.
- All **six grading-session tests** and the actual offline-viewer parser
  passed; all 100 ratings and the packet hash validate.
- The ML5.3 verifier recomputed answer metrics/intervals and verified all
  100 outputs, 50 paired cases/six PDFs, retained histories and **64 prior
  immutable checkpoints**.
- Independent aggregate checks verified all **17 input hashes**, exact
  copied result sections, decisions and **42 numerical table rows**.
- `git diff --check` passes. No production implementation changed; frontend
  builds/UI checks were not repeated for this documentation closeout.

Detailed sources: `docs/ML5_PROTOCOL.md`, `docs/ML5_RESULTS.md`,
`docs/ML53_COMPLETION_RESULTS.md`, `docs/ML5_CONTEXT_COHERENCE_RESULTS.md`
and the input reports listed by hash in the closeout JSON. Private questions,
contexts, outputs, ratings, keys and model artifacts remain local and ignored.

## Next phase

**Recommended next: ML7 write-up**, using the completed results for the model
card, dataset card, final results and README update. ML6 is optional; choose
it separately if a calibrated answerability gate is a project priority.
Its training/calibration must use TRAIN data and a fresh preregistered
validation plan; neither existing frozen question file may be reopened for
new fitting, selection or evaluation. New validation data would be required
for a further independent claim. Neither
ML6 nor ML7 has been started by this closeout. No commit was requested.
