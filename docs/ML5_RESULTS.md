# ML5.2 frozen retrieval results

October 17, 2026. The single approved retrieval milestone completed in
23 minutes 30 seconds. **Keep hybrid + concepts with the cross-encoder as
the live default.** The preregistered full LambdaRank model improved
Recall@5, but did not improve pooled MRR and had lower independent-set MRR
and nDCG point estimates. The switch rule failed. No service setting changed.

These are retrieval results. No LLM answers were generated or graded.

## Collections and uncertainty

| Collection | Total | Answerable, scored | Unanswerable, counted |
| --- | ---: | ---: | ---: |
| Original TEST | 80 | 65 | 15 |
| Independent | 78 | 62 | 16 |
| Pooled | 158 | 127 | 31 |

Both collections' answerable questions cover the same six PDFs. There are
six pooled document clusters, not twelve independent clusters. Reported
means weight questions equally; intervals resample entire PDFs, keeping both
collections' questions together: 2,000 resamples, seed 20261006. Only six
documents and multiple descriptive comparisons limit generalization.
Independent question authorship does not imply independent documents.

The independent set had higher CE MRR than the original set on this run;
lower lexical overlap alone did not make it uniformly harder. Avoid the
earlier expectation of greater difficulty as a conclusion from these data.

## Primary comparison: original ML4 seed-0 artifact versus CE

Absolute values with 95% document-bootstrap intervals:

| Set / method | Recall@5 | MRR@10 | nDCG@10 |
| --- | --- | --- | --- |
| Original / CE | 0.9231 [0.8750, 0.9697] | 0.8213 [0.7257, 0.9214] | 0.8385 [0.7631, 0.9206] |
| Original / ranker | 0.9846 [0.9538, 1.0000] | 0.8454 [0.7576, 0.9242] | 0.8627 [0.7961, 0.9256] |
| Independent / CE | 0.9839 [0.9508, 1.0000] | 0.8414 [0.7904, 0.9014] | 0.8638 [0.8232, 0.9100] |
| Independent / ranker | 1.0000 [1.0000, 1.0000] | 0.8102 [0.7654, 0.8680] | 0.8472 [0.8125, 0.8857] |
| Pooled / CE | 0.9528 [0.9302, 0.9762] | 0.8311 [0.7716, 0.8905] | 0.8509 [0.8019, 0.8966] |
| Pooled / ranker | 0.9921 [0.9767, 1.0000] | 0.8282 [0.7700, 0.8925] | 0.8551 [0.8079, 0.9036] |

The ranker's independent Recall interval is degenerate because every scored
question was a hit. It does not establish perfect retrieval on future PDFs.

Paired ranker-minus-CE differences with 95% document intervals:

| Set | Recall@5 difference | MRR@10 difference | nDCG@10 difference |
| --- | --- | --- | --- |
| Original | +0.0615 [+0.0303, +0.0938] | +0.0241 [-0.0398, +0.0841] | +0.0242 [-0.0230, +0.0756] |
| Independent | +0.0161 [0.0000, +0.0492] | -0.0312 [-0.0866, +0.0115] | -0.0167 [-0.0631, +0.0253] |
| Pooled | +0.0394 [+0.0236, +0.0476] | -0.0029 [-0.0551, +0.0385] | +0.0042 [-0.0364, +0.0375] |

The fixed switch checks are: positive pooled MRR lower bound **fails**;
Recall lower bound at least -0.02 **passes**; nonnegative MRR/nDCG point
differences in each set **fails**. Retain CE. Recall improvement alone does
not show that the best answer page appears earlier in the ranking.

Exact paired Recall McNemar: original 0 lost / 4 gained, p=0.125;
independent 0 / 1, p=1.0; pooled 0 / 5, p=0.0625. These are supporting tests:
question outcomes within a PDF are dependent.

## Declared ablations

Pooled seed-0 results; all variants were frozen before TEST. The primary
remains the original full-feature artifact. Intervals below are paired MRR
differences against CE. Full per-set/per-seed tables and absolute intervals
are in `ml/results/ml5_frozen.json`.

| Variant | Recall@5 | MRR@10 | nDCG@10 | MRR difference vs CE [95% CI] |
| --- | ---: | ---: | ---: | --- |
| Fused + concepts | 0.9528 | 0.7482 | 0.7868 | -0.0829 [-0.1493, -0.0095] |
| Fused passages | 0.9370 | 0.6851 | 0.7416 | -0.1460 [-0.2553, -0.0514] |
| Fused + links | 0.9528 | 0.7482 | 0.7868 | -0.0829 [-0.1493, -0.0095] |
| CE + concepts | 0.9528 | 0.8311 | 0.8509 | reference |
| CE passages | 0.9606 | 0.7941 | 0.8271 | -0.0370 [-0.0742, -0.0040] |
| CE + links | 0.9528 | 0.8311 | 0.8509 | 0.0000 [0.0000, 0.0000] |
| Full ranker + concepts | 0.9921 | 0.8282 | 0.8551 | -0.0029 [-0.0551, +0.0385] |
| Ranker passages | 0.9685 | 0.7936 | 0.8267 | -0.0375 [-0.1110, +0.0187] |
| Ranker + links | 0.9843 | 0.8281 | 0.8518 | -0.0030 [-0.0557, +0.0470] |
| Without CE features | 0.9606 | 0.7824 | 0.8222 | -0.0487 [-0.1212, +0.0137] |
| Without lexical features | 0.9764 | 0.8192 | 0.8442 | -0.0119 [-0.0656, +0.0437] |
| Without dense features | 0.9764 | 0.8235 | 0.8504 | -0.0076 [-0.0532, +0.0285] |
| Without concept features | 0.9764 | 0.8181 | 0.8485 | -0.0130 [-0.0855, +0.0513] |
| Without context features | 0.9764 | 0.7891 | 0.8286 | -0.0420 [-0.0928, +0.0061] |
| Without fusion features | 0.9606 | 0.8179 | 0.8499 | -0.0132 [-0.0850, +0.0498] |

Matched concept/link comparisons from the saved metrics-only audit:

| Comparison | Original MRR difference | Independent MRR difference | Pooled MRR difference [95% CI] |
| --- | ---: | ---: | --- |
| Concepts on minus passages, CE | +0.0318 | +0.0424 | +0.0370 [+0.0040, +0.0742] |
| Concepts on minus passages, ranker | +0.0353 | +0.0340 | +0.0346 [-0.0126, +0.1023] |
| Links on minus off, CE | 0.0000 | 0.0000 | 0.0000 [0.0000, 0.0000] |
| Links on minus off, ranker | +0.0190 | -0.0202 | -0.0001 [-0.0343, +0.0235] |

**OKF verdict:** including concept candidates helps pooled CE MRR on these
six PDFs. The ranker comparison is uncertain. Link expansion demonstrates
no pooled gain and stays opt-in. These are descriptive, unadjusted ablations;
do not make causal or broad answer-quality claims from them.

Feature removals versus the full ranker, pooled MRR differences:

| Removed group | Difference [95% CI] |
| --- | --- |
| CE | -0.0458 [-0.0853, -0.0148] |
| Lexical | -0.0090 [-0.0368, +0.0198] |
| Dense | -0.0047 [-0.0228, +0.0197] |
| Concept | -0.0101 [-0.0534, +0.0243] |
| Context | -0.0391 [-0.0746, -0.0076] |
| Fusion | -0.0103 [-0.0364, +0.0141] |

Correlated signals and multiple comparisons limit attribution. Do not tune
or replace the frozen primary using these TEST results.

## Robustness and descriptive types

| Full-ranker seed | Pooled Recall@5 | MRR@10 | nDCG@10 | Paired MRR vs CE [95% CI] |
| --- | ---: | ---: | ---: | --- |
| 0, primary | 0.9921 | 0.8282 | 0.8551 | -0.0029 [-0.0551, +0.0385] |
| 1 | 0.9764 | 0.8157 | 0.8453 | -0.0154 [-0.0907, +0.0474] |
| 2 | 0.9921 | 0.8249 | 0.8502 | -0.0062 [-0.0550, +0.0419] |

No seed has a positive pooled MRR point difference against CE. Seed 0 was
chosen before TEST; it is not a post-test best-seed selection.

| Pooled question types | Questions | CE MRR | Ranker MRR | Paired difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| Definition-dependent | 43 | 0.7810 | 0.8419 | +0.0609 [+0.0246, +0.1052] |
| Other types | 84 | 0.8568 | 0.8212 | -0.0355 [-0.1050, +0.0283] |

Definition-dependent means `definition` or `needs-definition`; these are
descriptive strata, not query-time features or a basis for a new routing
rule. Individual type tables are retained in the aggregate report.

## Integrity and next step

The fixed receipt is **complete**. Both sets were read during the one
authorized milestone; do not run the frozen evaluator again. Hash checks,
474 retrieval calls, TEST-only membership, shared-PDF pairing, seed pairing,
metric bounds, paired statistics and the switch rule all pass. The log has
no runtime errors or warning lines. The original ML4 artifact and protocol
are unchanged. The preceding 388 Python tests passed; no production source
changed during this run. No UI was operated or LLM started.

Result SHA-256:
`af512bac091475f57133599ad79569ce32fab539277d9d0e45da26c4d3ba2e35`.
`ml/results/ml5_frozen_analysis.json` records the declared matched ablations
derived from saved outcomes, without repeated question reads or inference.
The private receipt, metrics-only audit, log and grading inputs remain under
ignored local directories. No commit was requested or made for ML5.

The predeclared grading inputs contain 50 questions: 20 answerable and five
unanswerable from each set, with both methods' top-eight contexts. They are
inputs for **100 future answers**, not generated or graded answers yet.

**Next: ML5.3**, blind answer generation and human grading using those saved
inputs and the existing protocol. Obtain separate CPU approval before LLM
work; do not reopen frozen question files or repeat retrieval.
