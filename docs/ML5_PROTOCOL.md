# ML5 frozen evaluation protocol

Registered October 17, 2026, before opening either frozen test set. ML5.1
uses TRAIN only; the later frozen milestone requires separate CPU approval.
The primary comparison and default-switch rule were registered in ML4.2.

## Development and frozen artifacts

TRAIN has 120 questions: 95 answerable and 25 unanswerable, across nine
answerable source PDFs. Fit and score retrieval ablations only on answerable
TRAIN questions, using leave-one-document-out folds. Hold out the entire PDF
for every fold. Use the existing fixed LambdaRank parameters, without search,
and seeds 0, 1 and 2. Report each seed and the mean of per-question outcomes;
never choose the best seed. Unanswerable rows are counted but excluded from
retrieval metrics and ranker fitting.

The frozen primary model is the existing ML4 full-feature seed-0 artifact,
SHA-256 `7e35f36de053c0b970658c769f789bb40fdc423da879256d38890380b5c5571f`.
Retain it unchanged. Save the other 26 learned variant/seed artifacts under
ignored `ml/models/artifacts/ml5/`. These final artifacts fit all answerable
TRAIN rows; their reported development scores come from held-out folds.
Record model hashes, ordered feature subsets, source-code hashes, fixed
parameters and TRAIN candidate provenance in `protocol.json`.

## Declared comparisons

Every pool has at most 24 candidates, retrieved through the service code.
One raw cross-encoder logit per unique candidate text is shared across pools.
Compare three pools: passages plus concepts, passages only, and passages plus
concepts with the existing bounded one-hop link expansion. Links retain the
ML4.4 policy: protect eight seeds, add at most four dependencies, and never
exceed the 24-candidate budget.

| Variants | Ranking | Pool |
| --- | --- | --- |
| fused, cross_encoder, ranker_full | Fused order, raw CE logit, full LambdaRank | Concepts, links off |
| fused_passages, ce_passages, ranker_passages | Same three rankers | Passages only |
| fused_links, ce_links, ranker_links | Same three rankers | Concepts, links on |
| without_ce, without_lexical, without_dense | LambdaRank with one group removed | Concepts, links off |
| without_concept, without_context, without_fusion | LambdaRank with one group removed | Concepts, links off |

The six groups partition the 27 query-time features:

| Group | Features |
| --- | --- |
| CE (3) | Logit, gap, inverse CE rank |
| Lexical (4) | BM25, relative BM25, inverse BM25 rank, question coverage |
| Dense (3) | Cosine, cosine gap, inverse dense rank |
| Concept (7) | Concept flag, four concept categories, verified, title in question |
| Context (8) | Log length, normalized indexed-page position, five question-word flags, question length |
| Fusion (2) | RRF score, inverse fused rank |

Annotated question type and gold evidence are never features. Report feature
ablations against the full ranker and all variants against the cross-encoder.
These correlated-signal ablations are descriptive, not causal attribution.
The verified feature remains zero in these training bundles. Current-page
distance and learned link provenance remain deferred. No service defaults
change based on TRAIN results.

## Single frozen retrieval milestone

Use only `ml.eval.milestone_eval --protocol PATH --preflight` to check source
and artifact hashes without opening question sets. The actual run must
explicitly use `--frozen-test-milestone --out PATH`. It loads saved models,
claims a fixed exclusive receipt, then reads the original 80-question TEST
split and independent 78-question collection exactly once. Canonical source
membership routes rows before evidence validation. The inference path does
not fit models. A failure or interruption consumes the receipt: preserve all
artifacts and diagnose it; never silently delete the receipt and rerun.

Report each set separately and pooled, preserving set identity and namespaced
question IDs. Exclude unanswerable questions from retrieval metrics and
report their counts. Use Recall@5, MRR@10 and binary page nDCG@10 with duplicate
gold-page gain suppressed at its original candidate rank. Missing answer
pages remain in the ideal denominator. Bootstrap complete source PDFs,
including both sets' questions together when they share a PDF: 2,000
resamples, seed 20261006, question-weighted means and paired differences,
95% percentile intervals. Exact two-sided McNemar uses binary per-question
Recall@5 within each seed; do not apply it to fractional seed means. Treat
its p-values as supporting evidence because questions within PDFs depend
on one another; no multiplicity-adjusted confirmatory ablation claims.

Report definition-dependent (`definition` or `needs-definition`) versus other
question types, plus each individual type, descriptively. The primary test is
the fixed ML4 seed-0 full ranker minus CE on pooled MRR@10. Recommend switching
the default only if all three preregistered conditions pass:

1. The pooled paired MRR 95% interval is strictly above zero.
2. Each set's MRR and nDCG point differences are nonnegative.
3. The pooled paired Recall@5 lower 95% bound is at least -0.02.

Report the other seeds as robustness checks. Do not replace the primary
model with a better ablation or seed after seeing TEST. The harness reports
a recommendation; changing the live default is a separate user decision.
Save a private metrics-only audit and hashes for later analysis without
reopening questions or repeating inference.

## Blind answer grading (later subphase)

During that same frozen read, select 20 answerable and five unanswerable
questions from each set: 50 questions, two methods, 100 answers. Sort question
IDs, sample with Python Random seed 20261017 in original/independent and
answerable/unanswerable order, without consulting any model result. Preserve
the selected questions, evidence and each method's top-eight contexts in
ignored private `grading_inputs.json`. This permits later generation without
a second question read or retrieval run.

After separate laptop approval, generate one answer per question/method with
the frozen QA prompt, strict document-QA system message, local
`qwen2.5:3b-instruct`, temperature 0.1, 512-token maximum and no conversation
memory. Record the exact installed model identity and generation settings
before generation; do not tune them on answers. Do not start Ollama
automatically. Generation is not part of ML5.1.

Shuffle the 100 answer records with seed 20261018, assign opaque IDs and keep
the method key private. The human grader sees the question, supplied source
contexts and gold evidence, with no method names or retrieval scores. Grade
before revealing the key:

- Correctness: 2 = fully answers the question accurately; 1 = partly correct
  or materially incomplete; 0 = incorrect or unsupported answer. A justified
  abstention earns 2 on an unanswerable question, 0 on an answerable one.
- Grounding: 2 = all substantive claims supported and citations appropriate;
  1 = mixed support or citation errors; 0 = unsupported central claim. A
  correct abstention with no fabricated claim earns 2.
- Correct abstention on unanswerable questions: yes/no; not applicable for
  answerable questions. Record unsolicited abstentions there separately.

Retain both answers from each question when resampling PDFs. Report paired
mean correctness/grounding and abstention counts with document intervals;
do not treat these small, single-grader results as independent confirmation
or revise the retrieval switch rule. Human grading remains pending until
the user completes it. Retrieval metrics alone do not establish answer
quality.
