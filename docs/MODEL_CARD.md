# Margin model card

Recorded October 19, 2026. Scope: the trained OKF block pipeline and learned
reranker, plus the pretrained components used by the measured local assistant.
The frozen evidence is documented here; no model was loaded or fitted for ML7.

## Components and intended use

| Component | Implementation | Role / status |
|---|---|---|
| Block-role pipeline | Heading rules; source-weighted TF-IDF logistic probabilities and hand features into stacked LightGBM | Assign roles to native PDF blocks for OKF bundles |
| Definition detector D2 | Balanced logistic regression on sentence TF-IDF and cue/emphasis/layout features; threshold 0.4 | Find unheaded defining sentences |
| LambdaRank | LightGBM, fixed 150 trees, learning rate 0.05, seven leaves; 27 query-time features | Optional reranking of up to 24 candidates; not promoted |
| Dense embedder | sentence-transformers/all-MiniLM-L6-v2, 384 dimensions | Pretrained; no project fine-tuning |
| Cross-encoder | cross-encoder/ms-marco-MiniLM-L-6-v2 | Pretrained default reranker |
| Generator | qwen2.5:3b-instruct via Ollama | Pretrained document-QA generator; no project training |

Use: local assisted reading of native-text mathematical/research PDFs, with
source inspection. Outputs are draft classifications/concepts/answers, not
verified mathematical proofs, calibrated confidence estimates or authoritative
legal/financial/security guidance. Scans, arbitrary languages/layouts and
out-of-domain documents have not been established as supported populations.

## Trained pipeline

The pipeline gives headed blocks their merged heading-rule role. For unheaded
blocks, the maximum defining-sentence score >=0.4 yields `definition`; otherwise
the stacked classifier supplies the role and its own `definition` prediction
is demoted to `other`. `notation` merges into `definition`; six roles remain,
while macro F1 scores five substantive classes and excludes `other`.

Training uses 4,477 headed weak-label rows from 124 usable groups and 4,264
reliable unheaded negatives. D2 training has 458 positive/16,098 negative
sentences. Text vocabularies and preprocessing fit training sources only;
stacking uses grouped inner out-of-fold probabilities. Source weighting reduces
dominance of long PDFs. Weak heading labels and selected negatives introduce
noise and do not define an unbiased PDF-block population.

Saved local artifact: `ml/models/artifacts/okf_pipeline.joblib`, pipeline
version 0.1; SHA-256 `957a3a7a4ea207a298df09289a9bcd1aa3da477e1a5c65c51ebd16d33239e5a7`.
Use only trusted local joblib artifacts. It embeds learned text vocabulary and
is intentionally excluded from Git. Recorded runtime pins include
scikit-learn 1.6.1, LightGBM 4.7.0, joblib 1.4.2 and PyMuPDF 1.28.0 in
`local-llm/rag-api/requirements.txt`; this is not a complete environment lock.

| Adjudicated 300-block diagnostic sample, 12 PDFs | Estimate [95% document CI] |
|---|---|
| Pipeline role accuracy | 0.730 [0.653, 0.804] |
| Pipeline macro F1 | 0.723 [0.595, 0.773] |
| Contains-definition precision, all blocks | 0.877 [0.794, 0.959] |
| Contains-definition recall, all blocks | 0.475 [0.383, 0.561] |
| Unheaded detector precision | 0.864 [0.781, 0.952] |
| Unheaded detector recall | 0.560 [0.415, 0.699] |

These are enriched, assistant-annotated/adjudicated diagnostic results, after
two milestone reads of the classifier test sample. A second AI annotator
provided independent labels; the first adjudicated disagreements. They are
not independent human validation or a new untouched test. Headed proof-local
definitions can be missed structurally: the heading rule controls those blocks.

## Learned ranker

Training/evaluation uses 95 answerable TRAIN questions over nine PDFs,
leave-one-document-out, fixed parameters and seeds 0/1/2. Labels are exact
answer-quote match / answer-page match / other = 2/1/0; LightGBM gains are
0/1/3. This differs from binary first-occurrence answer-page nDCG used for
evaluation. Features cover CE, lexical, dense, concept, context and fusion
signals. Annotated question types and gold pages/quotes are never inputs.
Page position uses the highest indexed page, not a document page count that
the service cannot supply. The verified feature is always zero in training;
no measured benefit can be attributed to it.

Primary artifact: `ml/models/artifacts/ranker.joblib`, SHA-256
`7e35f36de053c0b970658c769f789bb40fdc423da879256d38890380b5c5571f`. Seed 0 and this original ML4 artifact were fixed before
TEST. The other ML5 artifacts/ordered feature subsets remain local and frozen.
Save/load checks feature order and dimension. `RERANK=ranker` is opt-in;
missing artifacts/signals fall back to CE. Ranker mode still computes CE
features and is not a replacement for its inference cost.

Pooled frozen Recall@5 rises 0.9528 -> 0.9921, but MRR@10 changes
0.8311 -> 0.8282, paired -0.0029 [-0.0551, +0.0385]. Independent MRR and
nDCG point differences are negative. The preregistered switch rule fails;
retain `cross_encoder`. Six shared TEST PDFs, multiple unadjusted ablations
and AI-authored questions limit conclusions. See [final results](ML7_RESULTS.md).

## Generation and operating limits

The frozen 100-answer study used Ollama 0.40.4, model digest
`357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b`, temperature 0.1,
512-token cap, 32768 context allocation and no GPU. Model identity/settings
are experiment provenance, not service-wide resource defaults. Thread counts
were two outputs at two threads, 36 at three and 62 at four. Two administrative
interruptions/retries are preserved; no quality-selected output retry occurred.

CE/ranker correctness means are 1.76/1.80 and grounding 1.50/1.58 out of two;
paired intervals include zero. Both correctly refuse 9/10 unsupported cases,
with zero answerable abstentions. The reviewer was the assistant, partially
blinded, with no independent human validation. Confidence from the service's
embedding-similarity validator is not a correctness probability; ML6 calibration
has not been implemented.

Mean/median successful generation request time was 136.7/117.9 s. The final
62-worker recovery peaked at 79.67% sampled RAM under an 85% stop threshold.
Model affinity limited it to half the logical CPUs, but total-laptop CPU reached
100%; this was not a global 50% CPU cap. Resource guards were evaluation
adapters, not automatic live-service protection or hardware-fault guarantees.

Known errors include mathematical extraction/reconstruction, incomplete
definitions, unsupported elaborations and citation misattribution. Context
selection improved speed in exploratory TRAIN screens but regressed individual
answers, so candidates remain deferred. No production-quality or fairness
assessment across languages/disability groups/document populations is claimed.

## Reproduction and maintenance

Code: `ml/okf/pipeline.py`, `ml/models/definition_features.py`,
`ml/models/prose_definitions.py`, `ml/ranking/features.py`, `ml/ranking/ranker.py`.
Exact saved reports and source hashes are indexed by
`ml/results/ml7_documentation.json`. Training/rebuilding requires local rights
to the excluded data, version-compatible dependencies and explicit laptop
approval. Existing frozen tests are consumed; inspect saved aggregates instead
of rerunning them. Do not select thresholds, seeds or features from TEST results.
Keep future changes on TRAIN with a fresh validation plan and new independent
data before any further generalization claim.

Third-party model/data licenses are separate from repository code. This card
does not grant redistribution rights to model weights, learned vocabularies,
source PDFs or their quoted evaluation records. See the [dataset card](DATASET_CARD.md).
