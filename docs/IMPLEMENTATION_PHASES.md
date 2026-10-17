# Implementation Plan

**Revised:** October 6, 2026

This replaces the original plan in this file (Firestore data model, S3
presigned saves, an Express API). That architecture was deleted in September
2026 (`ca823f9`, `e1f242c`). Margin is now a local-first, single-user reader.
History lives in `docs/implementation_log.md` (core and ML) and
`docs/frontend_implementation_log.md` (UI).

---

## 1. Where the project stands

### Done and committed

| Track | Phases | Commits | Outcome |
|---|---|---|---|
| Demolition | 0–1 | `ab63d6f` → `e1f242c` | Old save engines, collaboration code, Vision OCR, Firebase auth, S3 sync, sharing and the Express backend removed. |
| Foundation | 2 | `f9c0944` | Pure `src/core` with an ESLint-enforced boundary, Vitest harness, CI, design tokens. |
| Workspace and ink | 3–6 | `b513719` | Recursive pane/tab workspace; layered canvases, Kalman latency prediction, Bézier fitting in a worker, exact swept-disc eraser, one shared undo history. |
| Pages | 7 | `95227a1` | UUID page identity; reorder, rotate, merge, split, extract; page organiser. |
| Notes, library, search, export | 8, 8R.1–8R.5 | `7a058e9`, `f390691` | Multi-anchor Markdown/KaTeX notes, folder library, standard PDF annotation export, repairs. |
| Frontend | F0–F8 | `d5d27d9` → `0e0847e` | Token/depth system, chrome, reading area, library, organiser, side panels, dialogs, static demo build. |
| Find and chrome | 8R.6, F8R.1, F8R.2 | `9e79ffa` | Literal find over native PDF text (OCR and semantic search removed); redesigned header, find bar, tool dock, document tabs, panel bar, portal tooltips. |
| ML data | ML1 (part) | `a11f5a9` | Dataset manifest and PDF block extraction with weak heading labels (see ML1). |

### Still open from the earlier tracks

- Manual acceptance of Phase 8R and the F8R.2 chrome (done by the user; the
  checks are listed in the logs).
- Publishing the static demo.
- `README.md`, `PROJECT_SUMMARY.md` and `docs/CLOUD_ARCHITECTURE.md` describe
  removed systems and must be rewritten (ML7).

---

## 2. Roadmap change (October 2026)

The old Weeks 9–17 (content-addressed store and version history, cache
policies against Belady's algorithm, OCR escalation, layout detection and
reading order, knowledge bundles) are replaced by one ML track.

**Why.** Every ML part of Margin was a pretrained tool wired together
(PaddleOCR, llama.cpp, a web-trained cross-encoder). The new track gives the
project ML that is designed, trained and evaluated in the repo, and that the
product depends on:

- **Question answering over a PDF stays**: the local LLM answers, citing pages.
- Its context comes from two sources:
  1. an **OKF knowledge bundle** per PDF ([Open Knowledge Format v0.2][okf]):
     one Markdown file per definition, theorem, lemma, algorithm or notation,
     linked to the results it uses, with page provenance and human
     verification;
  2. **hybrid search** over the PDF text.
- **Models owned by the project:**
  1. a **block classifier** that finds those definitions and theorems (the
     bundle cannot be built without it);
  2. a **learned ranker** that decides what the LLM sees;
  3. an optional **answerability gate** that says "not in this PDF" instead
     of guessing.

Applying OKF to PDFs is this project's adaptation; the spec was written for
knowledge about data systems, and producers define their own `type` values.

**Postponed:** custom OCR (detector + CTC recogniser), reading order via
minimum feedback arc set, math OCR, Devanagari, version history, the cache
benchmark. **Cut:** the Belady benchmark and the old "knowledge bundles" week
(replaced by OKF).

[okf]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

---

## 3. ML track

Time budget: 12–15 hours per week alongside placements. Training runs locally
or on free Kaggle GPUs; inference runs on CPU.

### Rules for every ML phase

- **Splits by source group, never by file or block.** `group` in
  `Test PDFs/manifest.csv` marks an independent source (author, course,
  template). Train, development and test groups never mix.
- **The test set is frozen** once created and read only at milestones.
- **Report intervals, not single numbers:** bootstrap over documents; McNemar
  for paired right/wrong outcomes; 3 seeds for ablations.
- **Write the model and evaluation code by hand** (classifier features,
  ranker, gate, statistics). Data plumbing may be assisted.
- `ml/out/` holds extracted text from copyrighted PDFs and is never committed.

### ML1 — Dataset and blocks (Oct 1–12) · in progress

| Deliverable | Status |
|---|---|
| `Test PDFs/manifest.csv`: 57 PDFs, 37 source groups, `use` = main / scan-slice / other | ✅ `a11f5a9` |
| `ml/data/extract_blocks.py` + `heading_rules.py`: visual lines, gutter-based columns, furniture and annotation removal, blocks, weak labels, heading-free text | ✅ `a11f5a9` |
| Full run: 51 PDFs → 12,407 blocks, 1,131 weak labels | ✅ (output in `ml/out/full/`) |
| Add independent native-text textbook: Levin third edition (CC BY-SA 4.0); corpus now 58 PDFs / 38 groups | Implemented; 1,830 added blocks / 214 weak labels |
| Grouped split: 23 train/dev groups, 10 test, 5 excluded, written to `ml/splits.json` | Complete; user accepted and froze on October 6, 2026; 84 ML tests passed |
| ML1.4.2 sample and offline labelling page | Implemented: 300 test blocks; weak labels hidden; 92 Python + 7 JS tests pass; user UI acceptance pending |
| ML1.4.3 evaluation-question format and validator | Implemented and tested; 116 Python tests pass; real user questions pending |
| 300 hand-labelled test blocks (definition / theorem / proof / example / notation / algorithm / other), including definitions written as prose | ☐ user |
| 200 evaluation questions over ~15 PDFs (gold pages + quote), ~40 unanswerable | Pending full set; five authored starter questions validate |
| ML1.4.4 baseline: vector-only and vector + cross-encoder Recall@5 / MRR@10, document bootstrap | Implemented and measured on five examples; 124 Python + 7 JS tests pass; full-collection evaluation pending |

**Acceptance:** splits file committed; hand labels and questions stored;
baseline table with confidence intervals.

### ML2 — Block classifier v1 (Oct 13–19)

Started October 6 at the user's request, while ML1 human-data acceptance is
pending. ML2.1–ML2.10 tooling is implemented and verified; independent human
acceptance remains pending. ML2.E1 has expanded training; its source audit is partial.
Grouped weak-label development is measured; final independent-label acceptance
remain later work. Finish the LaTeX audit, develop on expanded training only,
and review hand labels before any final frozen-test evaluation.

| Substep | Scope | Status |
|---|---|---|
| ML2.1 | Heading-free weak training inputs, source cap, train-only grouped folds | Implemented; 548 rows, five folds; no classifier trained |
| ML2.2 | Majority/heading baselines and first heading-free TF-IDF/logistic classifier | Implemented at user's request; ten active model tests; 141 Python tests pass; training-only smoke fit, no held-out scores |
| ML2.3 | Five train-only source-fold runs, majority comparison, out-of-fold class metrics and document intervals | Implemented and measured; weak-label logistic accuracy 0.403 / macro F1 0.236; gold test untouched |
| ML2.4 | Multinomial Naive Bayes on identical source folds and TF-IDF settings | Implemented and measured; accuracy 0.422 / macro F1 0.237; 157 Python tests pass; gold test untouched |
| ML2.5 | Layout-only LightGBM on identical source folds; five layout measurements plus category | Implemented and measured; accuracy 0.297 / macro F1 0.165; definition recall zero; 174 Python tests pass; gold test untouched |
| ML2.6 | Reproducible 50-mistake development audit and two fixed text candidates, requested to improve accuracy | Complete text-only provisional audit; balanced logistic accuracy 0.412 / macro F1 0.270 / definition recall 0.391; does not beat NB accuracy; 192 Python tests pass; not independent gold acceptance |
| ML2.7 | Training-data quality repair: fragmented blocks and heading/table associations | Implemented; six rendered source pages checked, 549 revised rows; 208 Python tests pass; original source folds/reports preserved; balanced accuracy 0.408 / macro F1 0.264, changed data not an identical-row improvement |
| ML2.8 | Scoring scheme: notation merged into definition, `other` unscored, macro F1 only over classes in ≥3 sources and ≥3 folds | Implemented; algorithm not estimable; balanced logistic macro F1 0.444 on 4 classes (rescoring, same models and rows); 213 Python tests pass |
| ML2.9 | 300 test labels and gold evaluation with the same scheme and separate prose-definition recall | Assistant draft of 300 labels (61 flagged uncertain), user review pending; `gold_eval.py` built and tested on toy data, not run on the test set |
| ML2.10 | Cue-phrase, previous-block context and layout features; cue logistic and stacked LightGBM; 3-way definition / statement / neither scheme | Implemented; no interval-supported overall gain on 549 rows (proof F1 0.49→0.75 with context, definition recall 0.39→0.48 with cues); re-run on expanded data next |
| ML2.11 | Model choice on development data only, checked on the 14 non-arXiv sources | Stacked LightGBM frozen (non-arXiv accuracy 0.654, definition F1 0.70); `gold_eval.py` trains it on expanded weighted rows |
| ML2.12 | Review unmatched LaTeX-audit labels; fix heading and alignment issues; regenerate training data | Coverage 60%→84%, precision 0.995 [0.984, 1.000]; 121 unmatched reviewed, all correct; 276 Python tests pass |
| ML2.13 | Review the 300 test labels and run the milestone gold evaluation | Done with single-annotator AI labels (human check optional); two-stage accuracy 0.603, macro F1 0.659; prose-definition recall 0.262 at precision 0.842 |
| ML2.14 | Training signal for unheaded prose: reliable negatives, word-level emphasis, sentence-level detector, LaTeX positives | Done on dev: "contains a definition" recall 0.22 → 0.51 at precision ~0.88 (detector D2, threshold 0.4); LaTeX positives no gain; 287 Python tests pass |
| ML2.15 | Second milestone read: binary test field, frozen ML2.14 pipeline (`gold_pipeline.py`) | Done: role accuracy 0.603 → 0.753, macro F1 0.659 → 0.769; contains-definition recall 0.24 → 0.56 at precision 0.86; second read, single-annotator AI labels |
| ML2.16 | Independent second annotation (another AI), agreement and adjudication | Done: kappa 0.81 roles, 0.65 contains-definition; 85 adjudicated (44 B / 38 A / 3 mixed); on adjudicated gold the ML2.14 pipeline scores accuracy 0.730 vs 0.600, contains-definition P/R 0.88/0.48 vs 1.00/0.21 |
| Later ML2 steps | Evaluation on completed hand labels, final error analysis and BM25 | Pending; exact units defined when reached |
| ML2.E1 | Training-only expansion to 120 arXiv papers, LaTeX environment agreement audit and uncapped source-weighted fitting | 120 papers extracted, 3,665 new weak labels, 4,477 uncapped weighted rows; all classes in every fold. Audit partial: 2/20 source archives, HTTP 429. Frozen test unchanged |
| ML2.E2 | Existing definition-focused models on expanded rows; paired source-group intervals; source-audit integrity repairs | Comparison complete: stacked weak-label accuracy 0.804 / macro F1 0.759, definition recall 0.620; frozen test untouched. Audit still partial: 5 downloaded / 3 readable of 20; HTTP 429 and two truncated archives |
| ML2.E3 | Fixed-sample audit accounting and exact-version manual source handoff | Accounting verified: all 20 papers / 742 labels included, 103 resolved / 639 unresolved. Source collection still blocked by HTTP 429; 3 readable / 17 needed; 270 Python tests pass |
| ML2.E4 | Verify source download through Codex's built-in browser | Browser download of 2601.00107v1 succeeds: 8,471,681 bytes, complete gzip/TeX archive. Audit now 4 readable / 16 needed, 113/742 labels aligned; automated HTTP 429 did not establish browser unavailability |
| ML2.E5 | Complete remaining source downloads and automatic comparison | Complete: 20/20 readable sources; 446/448 aligned labels agree (99.55%), 60.4% coverage; 294 unresolved and independent human/gold acceptance remain; 270 Python tests pass |

- Train on `text_without_heading` so the model cannot learn the heading regex.
- Baselines: majority class; headings only (the regex).
- Models: TF-IDF + logistic regression; multinomial Naive Bayes; LightGBM with
  layout features (bold ratio, relative font size, indent, maths-character
  ratio, gap above, slide/paper/textbook category).
- Grouped cross-validation on train groups; retain usable rows and weight each
  by 1 / rows from its source (ML2.E1 replaces the historical 200-row cap).
- Own BM25 implementation (for ML3).

**Acceptance:** per-class F1 with bootstrap intervals on the hand-labelled
test set; recall on prose definitions reported separately; error analysis of
50 mistakes.

### ML3 — OKF bundle and hybrid retrieval (Oct 20–26)

**Progress (Oct 14):** ML3.1 done: bundle writer, links, conformance checker; all 48 main PDFs build conformant bundles (2,245 concepts, 6,587 links). ML3.2 (Oct 14): `POST /bundle` on the RAG service; title/link gold check (held-out: concept precision 0.93, titles good 0.75 / usable 0.92, link precision 0.76); fallback concepts dropped (1,188 concepts, 1,591 links); hand-written BM25 + RRF hybrid retrieval with harness (smoke run only, 2 questions). ML3.3 (Oct 14): Knowledge panel in Margin (build, filter, jump to region, Verify into OKF `verified` + log, export zip), standalone `/bundle` server without Docker. ML3.4 (Oct 14): 200 evaluation questions (VALID; 40 unanswerable; 120 train / 80 test); on the train split hybrid RRF beats dense retrieval (paired MRR@10 +0.101 [+0.024, +0.178]) and hybrid + OKF concepts beats it on both Recall@5 (+0.074) and MRR@10 (+0.117). ML3.5 (Oct 15): `/query` uses hybrid retrieval + OKF concepts (concept citations with region and verification), runs without Docker (embedded Qdrant, Ollama `qwen2.5:3b-instruct`); live code on train: MRR@10 0.787 vs 0.775 for the previous dense + rerank service (paired +0.012 [−0.013, +0.053], not significant). ML3 complete; next ML4 (learned ranker), bar MRR@10 0.787.

- Bundle writer: one concept file per classified block with `type`, `title`,
  `description`, `resource` (`margin://doc/<fingerprint>/page/<pageId>#bbox=…`),
  `sources`, `generated`, `status: draft`; `index.md` per document.
- Links from references ("by Theorem 3.4", "Definition 2.1") and defined-term
  mentions.
- Conformance test against spec §11 (frontmatter present, non-empty `type`).
- Knowledge panel in Margin with a **Verify** action that writes
  `verified: {by: human:<id>, at: …}`.
- Hybrid candidates: BM25 + existing vector search, reciprocal rank fusion.

**Acceptance:** bundles generated for all main PDFs and conformant; panel
works; fusion baseline in the results table.

### ML4 — Learned ranker and demo (Oct 27–Nov 2)

**Progress (October 17, ML4.2):** corrected page-position run
complete, 95 answerable train questions / 9 documents, leave-one-document-out,
24 live-service candidates. LambdaRank Recall@5 0.968 [0.938, 1.000], MRR@10
0.826 [0.770, 0.887]; cross-encoder 0.926 / 0.787. Paired MRR gain +0.039
[+0.009, +0.068] is supported on development data; Recall gain +0.042
[-0.011, +0.091] is inconclusive. Full-training artifact saved and reloaded;
cross-encoder stays default pending ML5. 332 Python tests, 198 frontend tests
and production build pass. ML5 protocol pre-registered below. nDCG train
measurement, link expansion and optional current-page distance remain to
scope with the user; full ML4 demo acceptance is still pending.

**Progress (October 17, ML4.3):** page nDCG@10 implemented once
for baseline/hybrid/live/ranker evaluation and measured on the same cached
training candidates, with leave-one-document-out. LambdaRank 0.846
[0.788, 0.908] vs CE 0.822 [0.750, 0.893]; paired +0.024 [+0.004, +0.044].
Recall/MRR reproduce ML4.2 exactly; saved artifact unchanged. 350 Python tests
and production build pass. Frontend randomized quadtree test exposed an
existing boundary-overlap miss (197 passed / 1 failed); deterministic
reproduction and seed are recorded in the log. Frozen tests not evaluated.
ML4.2 committed as `412a30d`; link expansion and optional current-page
distance remain to scope with the user.

**Annotation-index repair (October 17):** the quadtree failure
found during ML4.3 is fixed by descending only into children that fully
contain an annotation, retaining spanning annotations at their parent.
204 frontend tests (including the original failing seed), core lint and
the production build pass. Manual eraser/undo verification remains pending;
see the annotation repair entry in `implementation_log.md`.

- LightGBM ranking (LambdaRank) over passages and concept files.
- Features: BM25, vector similarity, cross-encoder score (as a feature), term
  and maths-token overlap, block type, is-concept, is-verified, reached by
  one-hop link, distance to the page being read.
- One-hop link expansion: a retrieved theorem brings the definitions it uses.
- Replaces fixed top-8 vector search and the web-trained reranker in
  `local-llm/rag-api`.

**Acceptance — demo milestone:** chat answers cite definitions and pages;
Recall@5 / MRR / nDCG table against all baselines.

**ML4.4 protocol (October 17; fixed before the expansion experiment):**
Compare `hybrid_concepts` against opt-in `hybrid_concepts_links`. From the
original fused top eight, expand only result concepts (theorem/lemma/etc.)
to their directly used definitions/notations in the same PDF and page scope.
Protect the eight seeds; retain at most four unique dependency targets and
fill the remaining 24-candidate budget in fused order. New dependencies
replace tail candidates; no extra CE budget or artificial score boost.
Cycles never recurse. The existing 27 features and `PARAMS` stay fixed;
`reached_by_link` is candidate provenance, not an added learned feature in
this experiment. Report TRAIN-only leave-one-document-out results for
fused, CE, pointwise LR and LambdaRank, seeds 0/1/2 without best-seed selection.
Average per-question metrics across seeds before document bootstrapping;
also report each seed, paired on-minus-off Recall@5/MRR@10/nDCG@10 and
candidate recall. Primary expansion comparison is paired LambdaRank MRR;
the CE comparison describes the default live reranker. Keep expansion opt-in
and the existing saved artifact/defaults during this step, irrespective of
training results. No test evaluation or LLM generation is authorized here.

**ML4.4 complete (October 17):** opt-in live
expansion, indexed `uses` metadata, scope/budget/provenance safeguards and
the paired three-seed evaluator are implemented. 373 Python tests, 204
frontend tests and production build pass. Approved TRAIN comparison completed
on 95 questions / 9 documents: expansion added 12 candidates across 7 queries;
candidate recall stayed 94/95. CE metrics were unchanged. Three-seed mean
LambdaRank MRR 0.812 off / 0.810 on; paired -0.0016 [-0.0180, +0.0164],
no demonstrated gain. Expansion stays opt-in; saved artifact/defaults unchanged.
Seed-0 off reproduces ML4.3 exactly. Next: ML5.1 training-only ablations and
the inference-only milestone harness, before any frozen read.

### ML5 — Ablations and error analysis (Nov 3–9)

**Pre-registration (October 17, 2026; before the ML5 frozen read):**
Compare fused hybrid + concepts, the live cross-encoder, and the frozen ML4
LambdaRank artifact on identical 24-candidate pools. Freeze the artifact,
feature definitions, retrieval settings and scoring code before opening either
test set. Run inference once with `--frozen-test-milestone`; never fit or select
models using test questions. The existing `ranker_eval` leave-one-document-out
routine is a training-development evaluator, not the ML5 test evaluator.

- Report the original 80-question test split and independent 78-question set
  separately and pooled; exclude unanswerable questions from retrieval metrics
  and report their counts. Preserve question-set identity. Pool by question,
  clustering both sets' questions from the same PDF together for uncertainty.
- Metrics: Recall@5 (any answer-page hit), MRR@10 (first answer-page hit),
  and page nDCG@10. For nDCG, award binary gain to each answer page only at
  its first occurrence in the ranked candidates, retaining candidate ranks;
  discount by `log2(rank + 1)`. The ideal ranking contains all gold answer
  pages up to ten, including pages missing from the candidate pool. This is
  distinct from the ranker's graded training labels (quote/page/other = 2/1/0).
- Report 95% document-bootstrap intervals and paired differences using
  `ml.eval.stats.document_bootstrap` (2,000 resamples, seed 20261006).
  Report exact two-sided McNemar tests on paired Recall@5 outcomes; these
  are supporting evidence because questions within a document are dependent.
- Primary comparison: LambdaRank minus cross-encoder, pooled MRR@10.
  Change the default to `RERANK=ranker` only if its paired 95% interval is
  strictly above zero, each set's MRR and nDCG point differences are
  nonnegative, and the pooled Recall@5 difference's lower 95% bound is at
  least -0.02. Otherwise keep `cross_encoder` and report an inconclusive or
  negative outcome. This rule is fixed before test outcomes are available.
- Select and freeze OKF on/off, link expansion on/off (if implemented), and
  feature-group ablations on TRAIN only, with leave-one-document-out and the
  plan's three seeds. Apply all frozen variants in the same milestone run;
  no test-guided redesign. Report definition-dependent versus other types as
  descriptive breakdowns. Annotated question types are never model features.
- Freeze a blind ~100-answer grading protocol before generation: identical
  questions/settings, hidden method names, randomized presentation and a
  written correctness/grounding rubric. LLM generation requires separate
  laptop approval; retrieval metrics do not establish answer quality.

- OKF on/off; link expansion on/off; feature groups.
- McNemar on Recall@5; bootstrap by document for MRR/nDCG; blind hand-grading
  of ~100 answers.
- Break down definition-dependent versus other questions.

**Acceptance:** ablation table with intervals and a written verdict on whether
OKF helps (reported either way).

**ML5.1 progress (October 17, 2026):** TRAIN-only ablation harness and guarded
inference-only milestone harness implemented. The fixed 15-variant matrix,
six feature groups, three seeds, original ML4 primary artifact, statistical
decision rule and later 100-answer blind grading are specified in
`docs/ML5_PROTOCOL.md`. 388 Python tests, 204 frontend tests and production
build pass. Approved TRAIN ablations complete: full ranker three-seed mean
R@5 0.961, MRR 0.812, nDCG 0.838; CE 0.926 / 0.787 / 0.822. Paired MRR gain
+0.0246 [-0.0014, +0.0506] remains inconclusive. Concepts improve full-ranker
MRR versus passages only by +0.0395 [+0.0043, +0.0812] on TRAIN; link expansion
does not demonstrate a gain. Feature-group results and caveats are in the
implementation log and `ml/results/ml5_train.json`. All 27 variant/seed model
references and source hashes pass preflight; original ML4 artifact unchanged.
At the ML5.1 checkpoint, no frozen evidence validation or test inference had
occurred. The subsequent ML5.2 result is recorded below. Service defaults
remain unchanged.

**ML5.2 readiness (October 17, 2026):** the ML5.1 protocol/artifact preflight
and TRAIN aggregate reproduction checks pass. `ml/results/ml5_readiness.json`
additionally snapshots the 12 eligible TEST PDFs, existing bundle markdown,
offline MiniLM model revisions/files, runtime package versions, supplemental
ingestion/schema dependencies and grading protocol document. Question files
are checked by existence/size only. The design brief (`use=other`) has no
bundle, consistent with the existing main-only bundle builder; retain that
passages-only source without rebuilding. The user subsequently approved the
single frozen inference run.

**ML5.2 complete (October 17, 2026):** the one-time milestone finished in
23m 30s with no runtime errors/warnings. Original TEST: 65 answerable/15
unanswerable; independent: 62/16. Both answerable collections share six PDFs.
Pooled CE R@5/MRR/nDCG 0.9528/0.8311/0.8509; fixed seed-0 ranker
0.9921/0.8282/0.8551. Paired MRR -0.0029 [-0.0551, +0.0385], with negative
independent MRR/nDCG point differences: preregistered switch rule fails.
Keep CE as default. Concepts improve pooled CE MRR versus passages by
+0.0370 [+0.0040, +0.0742]; links have no demonstrated pooled gain. Full
tables, limitations and verification are in `docs/ML5_RESULTS.md`,
`ml/results/ml5_frozen.json` and `ml/results/ml5_frozen_analysis.json`.
The receipt is complete, original model/protocol unchanged, and 50 questions'
paired contexts are staged for 100 future answers. Do not repeat frozen
inference. Next: ML5.3 blind answer generation and human grading, with
separate LLM approval.

### ML6 — Answerability gate (Nov 10–16) · optional

- Calibrated logistic regression on retrieval features (top scores, gap,
  agreement); LightGBM comparison.
- Threshold chosen as a Neyman–Pearson problem: false-answer rate ≤ α.
- "Not found in this PDF — search all open PDFs?" state in the assistant.

**Acceptance:** AUROC, calibration error, risk–coverage curve; replaces the
fixed threshold in `validator.py`.

### ML7 — Write-up (Nov 17–23)

- Results tables, model card, dataset card, decision log.
- Rewrite `README.md` and `PROJECT_SUMMARY.md`; mark
  `docs/CLOUD_ARCHITECTURE.md` historical.
- Buffer for end-semester exams.

---

## 4. Known constraints

- Weak labels cover only formatted headings: 114 definitions, 347
  theorem-type, 252 proofs, 245 examples, 122 algorithms, 5 notation. Prose
  definitions are measured only through the hand-labelled set.
- 10 groups have no headings at all (payments papers, non-maths documents);
  they supply "other" examples and unanswerable questions.
- Scanned PDFs (`use = scan-slice`) have no reliable text and are out of the
  ML track until an OCR phase is planned.
