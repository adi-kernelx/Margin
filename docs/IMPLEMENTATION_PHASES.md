# Implementation Plan

**Revised:** October 6, 2026

**Latest ML status, October 19, 2026:** ML1–ML5 implementation/experiments
and ML7 write-up are complete; optional ML6 is not implemented. Default stays
hybrid + OKF concepts + cross-encoder. ML5 checkpoint: `30be3a0`. Current
documentation: `docs/ML7_RESULTS.md`, `docs/MODEL_CARD.md`,
`docs/DATASET_CARD.md` and `README.md`. Next: review/checkpoint ML7, then
remaining manual product acceptance or a separately chosen engineering phase.

This replaces the original plan in this file (Firestore data model, S3
presigned saves, an Express API). That architecture was deleted in September
2026 (`ca823f9`, `e1f242c`). Margin is now a local-first, single-user reader.
History lives in `docs/implementation_log.md` (core and ML) and
`docs/frontend_implementation_log.md` (UI; local notes, not in the repository).

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
- `README.md`, `PROJECT_SUMMARY.md` (local notes, not in the repository) and `docs/CLOUD_ARCHITECTURE.md` (since removed) describe
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

**ML5.3 setup (October 18, 2026):** ML5.1/ML5.2 checkpoint committed as
`3f5d0f3`. Generation, checkpoint/resume, blind packet export, an offline
grading page and complete-ratings scoring are implemented. The original
50 saved questions resolve to six PDFs; 100 prompts were sealed without
reopening question files or repeating retrieval. Model digest and generation
sources are pinned. The pre-generation runtime clarification fixes a 32K
context window, two CPU threads and zero GPU layers, retaining the frozen
QA prompt, system message, temperature 0.1 and 512-token output cap; see
`docs/ML5_GRADING.md`. Manual grading-page checks remain pending with Aditya.

**ML5.3 timing progress (October 18, 2026):** after manual Ollama startup, a
wrapper/referenced-manifest identity mismatch was diagnosed and strictly
fixed before generation; unused preparation archived, prompts/settings
unchanged. The approved first two retained answers completed in 124.8 s and
230.0 s, without failures or retries, and the batch paused at 2/100. Runtime
confirmed CPU-only and the 32K window. Remaining 98 are roughly 5–8 hours or
longer on two threads, superseding the initial 1–3 hour forecast; a next
ten-answer batch is roughly 30–60 minutes. See `docs/ML5_GENERATION_TIMING.md`
and the numerical timing/preparation-v2 reports. At that checkpoint no further
generation was authorized; all grading remained pending. Next within ML5.3: approved
remaining batches and human grading. Next subphase afterward: ML5.4 synthesis
of retrieval and completed human grading.

**ML5.3 CPU amendment (October 18, 2026):** Aditya requested three threads
for future answers. A separate resource adapter and immutable amendment bind
the unchanged sealed plan, original two-answer journal prefix and adapter
source. Later answer events record effective options and amendment hash;
the two saved answers retain two-thread provenance. At configuration time no
additional generation had started and three-thread speed was unmeasured.
Use `ml.eval.answer_generation_resources` for subsequent
approved batches and disclose the mixed thread settings in the final report.

**ML5.3 ten-answer batch (October 18, 2026):** the explicitly approved batch
finished in 26m 57s on three CPU threads, then paused at 12/100. Mean request
161.7 s, median 108.5 s, range 28.9–306.4 s. All ten stopped normally; no
failures, retries, duplicate answers or frozen-question/retrieval reruns.
Plan, original journal prefix and amendment integrity checks passed. The
remaining 88 would take roughly four hours at this mean, with substantial
workload uncertainty; no further generation is authorized. See
`ml/results/ml5_generation_batch10.json`. Aditya raised interactive latency:
the live client also waits for a full answer, though its runtime options are
not explicitly identical to evaluation. Recommended next is a separate
TRAIN-only latency investigation before more generation; no optimizations
or quality grading have been performed. ML5.3 remains incomplete, and ML5.4
follows completed generation and blind human grading.

**ML5.3 latency investigation setup (October 18, 2026):** Aditya requested
the next latency step. Added a separate four-request streaming timing probe
using fresh diagnostic prompts from two manifest-validated TRAIN concept
bundles. It compares 18K versus 4K context-text byte budgets at fixed 32K
allocation, three CPU threads and a 128-token cap, collecting first visible
text plus separate server loading/prompt/output timings. No frozen questions
are read, retrieval/model fitting occurs or production defaults change. The
12-answer grading checkpoint and its sealed sources remain intact. Prepared
plan/integrity checks passed without model loading; full Python suite 421
passed. See `docs/ML5_LATENCY.md`. Next: workload approval for roughly 10–20
minutes, then measure before choosing any live optimization. This setup
does not establish an answer-quality or latency improvement.

**ML5.3 latency probe completed (October 18, 2026):** the approved four
TRAIN-only requests finished in roughly 4m 15s, all on three CPU threads.
Full-context mean first text 96.6 s / total 110.0 s; bounded-context 7.7 s /
17.3 s. Prompt processing used 85.8% of full-context request time, identifying
the main delay in these stress cases. All four outputs hit the 128-token cap;
quality/completeness is unassessed, cache/order effects are uncontrolled, and
these are not representative live-app timings. No default switch or general
speedup claim. Four unique attempts and recomputed metrics/hashes verified;
the 12-answer grading checkpoint is unchanged. See `docs/ML5_LATENCY.md` and
`ml/results/llm_latency_train.json`. Next: a TRAIN-only context-budget quality
comparison and separately scoped live-streaming work; no further model run
is approved. Remaining 88 grading answers/human grading are still pending.

**ML5.3 context-quality setup (October 18, 2026):** Aditya requested the next
quality step. Prepared six fresh AI-authored, answerable TRAIN questions over
three PDFs, with seven native page/quote checks and one two-reference question.
The separate screen will call actual in-memory service retrieval/CE reranking,
compare 18K/8-item versus 4K/3-item packing, audit reference retention and
generate twelve blind answers at the same 512-token cap on three CPU threads.
Native extraction expands typographic ligatures; exact checks retain case,
punctuation and math. No models have run for this screen. The 12-answer frozen
grading checkpoint and completed latency results are unchanged. No quality
or default-switch claim; see `docs/ML5_CONTEXT_QUALITY.md`. Next: approve the
20–40 minute CPU workload, then blind grading of twelve answers before any
live budget decision. Live streaming remains separately scoped.

**ML5.3 context-quality generation complete (October 18, 2026):** the approved
TRAIN retrieval/generation workload finished in 12m 23s after a transient
metadata-only preflight timeout resolved. Twelve unique answers completed;
all stopped normally, none hit the 512-token cap, no failed/retried generation.
All required quotes were retained for 6/6 questions by raw retrieval and both
budgets. Larger versus smaller budget mean first text 59.5/6.8 s and total
request 69.2/16.2 s. These selected TRAIN/cache-sensitive timings do not prove
equal accuracy or representative latency. Report metrics/hashes, twelve-row
blind packet/parser compatibility and protected experiment hashes verified.
Frozen generation remains unchanged at 12/100. **Next: Aditya's manual page
checks and blind ratings of the twelve TRAIN answers**, then aggregate paired
scoring before any budget decision. No further model workload, live default
change or streaming implementation is authorized by this run.

**ML5.3 context-quality review complete (October 18, 2026):** Aditya delegated
the answer review to the assistant. All twelve source/context-grounded ratings
were saved and hash-sealed before reading the private budget key. The neutral
result title is retained; methodology records the assistant reviewer, shared
question authorship, partial blinding and lack of independent human validation.
Correctness larger/smaller 1.833/1.667; grounding 1.667/1.500 (0–2 scale).
Both paired differences are -0.167, document-bootstrap 95% CI [-0.500, 0.000].
One paired question regressed on both metrics despite full quote retention,
so the predeclared screen holds the smaller budget. No significant population
difference or safe replacement is established from three clusters. Saved
aggregate result `ml/results/context_quality_train.json`; metrics/receipt/
parser/protected-source checks passed. No new model work, user/UI grading,
source changes or commits. **Next: revise experimental packing/grounding and
broaden TRAIN checks; no live budget change.** The separate frozen experiment
remains at 12/100; future answer reviews may use the user's assistant-grading
delegation with explicit methodology/protocol amendments as needed.

**ML5.3 context-selection/citation revision prepared (October 18, 2026):**
implemented a separate query-aware excerpt selector (six sources / 4K UTF-8
bytes, repetition removal and complementary coverage) plus a source-only
grounding prompt; existing live and sealed experiment sources are unchanged.
Prepared ten TRAIN cases across four PDFs: six known development cases, two
new answerable cases and two synthetic unsupported probes. Reuse cached CE
contexts for the first six; retrieve four new queries with the actual service
and compare twenty newly generated answers against the larger/original-prompt
variant. The combined change cannot isolate packing from prompting. Three
new literal native-reference claims and both whole-source nonce-absence
checks pass. Full Python suite: **446 passed**, one understood Windows core
discovery fallback warning. See `docs/ML5_CONTEXT_REVISION.md`. **Next: approve
roughly 20–40 minutes of three-thread CPU retrieval/generation, then assistant
review and paired TRAIN scoring.** No grading is required from Aditya; no
new model workload has started, improvement is unverified, and frozen ML5
generation stays at 12/100. Do not change live defaults from this preparation.

**ML5.3 context-selection/citation recheck completed (October 18, 2026):**
the authorized twenty-answer TRAIN comparison completed in 20m 13s, with
no failed/retried requests or length stops. All references retained for 8/8
answerable cases; both variants correctly abstained on 2/2 synthetic probes.
Revision versus larger/original-prompt correctness 1.50/1.80 and grounding
1.40/1.80 (0–2). Paired differences -0.30 [-0.444, -0.111] and -0.40
[-0.600, -0.125], with three/four paired regressions respectively. Exploratory
document-bootstrap intervals use four clusters and assistant review with
partial blinding/shared authorship; no population claim. Mean request time
26.6 versus 70.8 s does not justify quality loss. **Hold the revision; live
defaults unchanged.** Complete ratings were sealed before key access; runtime,
paired scores, parser compatibility and all 22 protected file hashes verified.
See `docs/ML5_CONTEXT_REVISION_RESULTS.md`. No user grading remains for this
TRAIN screen. **Next: isolate packing and prompt changes on cached TRAIN
contexts under a new fixed comparison and separate CPU approval.** The frozen
ML5 experiment remains paused at 12/100; no further generation is approved.

**ML5.3 cached packing/prompt factorial prepared (October 18, 2026):**
added an isolated four-condition diagnostic on the same ten previously
reviewed TRAIN cases: full/selected cached context crossed with original/
grounded prompts. Forty fresh answers are planned in counterbalanced
four-condition question blocks; exact saved context text and sealed prompt
functions are reused. No retrieval, encoder loading, fitting or new question
source is needed. Paired conditional effects, main effects and interaction
will use whole-document bootstrap intervals; all cases remain development
data and conclusions are exploratory. Assistant review is delegated, with
complete ratings sealed before scorer plan/key access; no manual grading
from Aditya. Full model-free suite **464 passed in 75.54 s, no warnings**,
including eighteen new synthetic tests. See `docs/ML5_CONTEXT_FACTORIAL.md`.
**Next: explicit approval for roughly 25–50 minutes of three-thread CPU LLM
generation, then forty-answer review and factorial scoring.** No new model
request has started; live defaults and previous/frozen experiments remain
unchanged. This preparation does not establish which component caused the
earlier regressions.

**ML5.3 packing/prompt factorial completed (October 18, 2026):** the approved
forty-request cached TRAIN comparison completed in 22m 41s with no failures,
retries or length stops. Correctness/grounding means: full/original 1.90/1.80,
full/grounded 1.60/1.50, selected/original 1.80/1.90, selected/grounded
1.60/1.40. Grounded prompt at full context: both differences -0.30
[-0.444, -0.111]; packing at original prompt: correctness -0.10
[-0.400, 0.200], grounding +0.10 [-0.333, 0.500]. Main effects/interaction
and historical cohorts are reported separately; average prompt-effect
intervals include/touch zero. Four clusters, selected/previously seen cases,
single assistant reviewer and multiple unadjusted contrasts make this
exploratory. All conditions abstained correctly on 2/2 synthetic probes;
both context packets retained references for 8/8 answerable cases. All three
candidates fail the individual-regression gate and remain on hold. Mean
request times full/original 49.2 s versus selected/original 21.1 s do not
justify adoption. Forty ratings sealed before plan/key disclosure, all
metrics/gates/parser checks and 34 protected file hashes verified; 464-test
Python suite unchanged and six parser tests passed. No live/default/frozen
change, UI work or commit. See `docs/ML5_CONTEXT_FACTORIAL_RESULTS.md`.
**Next: refine excerpt selection using the original prompt, then recheck
TRAIN under a separately fixed/approved workload.** No manual grading is
pending. Frozen ML5 generation remains at 12/100.

**ML5.3 original-prompt excerpt refinement prepared (October 18, 2026):**
added a separate focused selector: queried concept definitions first,
qualification-preserving adjacent units, complementary query coverage,
conservative duplication and early stopping instead of budget filling. Hard
limits four sources / 4K text bytes; original QA/system prompts unchanged.
The three-way cached TRAIN design generates thirty fresh answers on the same
ten development cases: full comparator, previous selector and refined
selector, all under the original prompt. No retrieval or encoder work. All
cases are previously seen; grading/intervals remain exploratory and assistant
review is delegated. Full model-free suite **487 passed in 27.17 s, no
warnings**, including twenty-three new synthetic tests. Title cleanup and
broader-window dedup edge cases were fixed before model work. See
`docs/ML5_CONTEXT_REFINEMENT.md`. **Next: seal/check inputs, request approval
for roughly 15–30 minutes of three-thread CPU generation, then review/score
all thirty answers.** No model request has started; prior and frozen
experiments/live defaults remain unchanged. No manual grading is required
from Aditya.

**ML5.3 original-prompt excerpt refinement completed (October 18, 2026):**
all thirty approved answers generated and assistant-reviewed; **hold** the
refined selector. Full / previous / refined correctness is **1.9 / 1.9 / 1.9**;
grounding **1.8 / 2.0 / 1.9**. Refined-minus-full correctness is **0.000
[-0.273, 0.273]**, grounding **+0.100 [-0.273, 0.545]**; refined-minus-previous
grounding **-0.100 [-0.273, 0.000]**. One refined correctness/grounding
regression versus full and one grounding regression versus previous fail the
predeclared gate despite equal mean correctness. Every condition retained
references for 8/8 answerable cases and abstained correctly on 2/2 synthetic
probes. Mean request time **30.8 / 13.1 / 5.1 s**, first text **26.4 / 9.2 /
1.9 s**; these are cached-context development timings, not live guarantees.
All thirty attempts completed normally in 8m 11s. Ratings were sealed before
grading-time condition disclosure; four document clusters, prior familiarity,
partial blinding and no human validation limit inference. Verification:
487 pre-seal Python tests, six parser tests, actual packet/rating parser and
all 44 protected hashes pass. See `docs/ML5_CONTEXT_REFINEMENT_RESULTS.md`.
No live change or commit; frozen generation remains 12/100.
**Next: diagnose coherent same-page excerpt merging while keeping the original
prompt, then validate a fixed comparison on a broader TRAIN sample under
separate workload approval.** No manual grading is pending.

**ML5 scope / same-page coherence prepared (October 18, 2026):** Aditya asked
how much ML5 remains and requested the broader TRAIN merge check. ML5.1 and
ML5.2 are complete. Original ML5.3 still requires **88/100 frozen answers to
generate and all 100 to review**; ML5.4 synthesis follows. The last frozen
batch suggests roughly four hours of remaining generation, with uncertainty;
small-context TRAIN timings do not replace that estimate. Recent TRAIN
optimization studies are additional scope. This next comparison is bounded:
report consider/defer and return to original closeout, with no automatic
further tuning cycle or live change.

Added a separate common-source same-page merger and fixed **18 cases / six
TRAIN PDFs / 36 fresh answers**, all with original QA/system prompts. Four
cached sentinels, eight new answerable prompts and six synthetic unsupported
probes; twelve answerable cases reported separately. Same-document/page
containment, whole-unit order, qualifications and hard UTF-8 budgets protect
provenance; ambiguous/disjoint cases fall back. Four context pools reused;
fourteen fresh service retrievals use a TRAIN-only in-memory index. No frozen
question read or default change. **511 model-free tests passed in 30.76 s,
no warnings**, including twenty-four new checks. Native references, study seal
and all **54 protected files** validate. See `docs/ML5_CONTEXT_COHERENCE.md`.
**Next: workload approval for roughly 25–50 minutes (potentially longer), then
run and assistant-review the 36 answers.** No encoder or LLM has loaded for
this comparison; no manual grading is required from Aditya.

**ML5.3 bounded same-page coherence check completed (October 18, 2026):**
all **36 approved answers / 18 TRAIN cases / six PDFs** generated and reviewed;
**defer the selector and end the current optional tuning cycle**. Full/coherent
correctness **1.833 / 1.833**, paired **0.000 [-0.167, 0.167]**; grounding
**1.778 / 1.889**, paired **+0.111 [0.000, 0.222]**. On twelve answerable cases,
correctness **1.750 / 1.750**, grounding **1.667 / 1.833**. One correctness
regression fails the gate; the classification remains incomplete despite
coherent evidence. Both conditions also return wrong mathematical formulas.
All 6/6 unsupported probes are correctly refused; complete native-reference
matches are 8/12 in raw/full/coherent alike (four extraction/layout mismatches,
zero additional packing loss). Mean request time **30.2 / 6.3 s**, first text
**24.9 / 2.2 s**; these exclude retrieval and are not live guarantees.
Indexing/retrieval plus generation **12m 59s**, generation **10m 58s**, no failed
or retried attempt. Ratings sealed before grading-time disclosure; exploratory
intervals and review limitations retained. **511 Python tests**, six parser
tests, actual packet/rating parser and all **54 protected hashes** pass.
See `docs/ML5_CONTEXT_COHERENCE_RESULTS.md`. No live change or commit.
**Next: original ML5 closeout—88 remaining frozen answers (roughly four hours
at their last measured rate), review of all 100, then ML5.4 synthesis.** No
automatic context-tuning iteration or further model workload. A decision to
defer the expensive frozen answer study must label that part incomplete;
ML5.1/ML5.2 are already complete. No manual grading is required from Aditya.

**ML5.3 original answer-study completion resumed (October 19, 2026):** Aditya
approved the remaining 88 answers and delegated review of all 100. A metadata
connection refusal was resolved by manual Ollama startup. The user then
reported 87% RAM and prior shutdowns under load; the verified model runner
was stopped during A013, preserving all twelve earlier outputs. Original
started/failed events and state remain intact. No output from that attempt
was saved or quality-reviewed.

After Aditya closed Claude and explicitly requested unattended continuation,
available RAM was approximately 7.35 GiB / 15.34 GiB. A tested resource-only
recovery retains the exact original plan, profile and successful prefix in
`ml/out/ml53_completion/resumed/`, with an explicit administrative A013 retry
and original failure history preserved. Prompts, model, 32K allocation, 512
cap and existing two/three-thread provenance are unchanged. The new runner
reserves model memory before loading, waits between answers for headroom,
checks RAM during work, can stop the verified model runner above 80% use,
sets Below Normal priority and unloads the model on exit. These sampled
controls are not a guarantee against hardware/thermal/power faults.
**516 model-free tests passed in 122.37 s, no warnings.** See
`docs/ML53_MEMORY_RECOVERY.md` and `docs/ML53_ASSISTANT_REVIEW.md`. The first
resumed output reached 13/100 at about 6m 37s, with observed RAM peak 72.2%;
generation remains in progress and may exceed the earlier four-hour estimate.
**Next: complete the approved original 100 outputs, review all opaque answers,
seal ratings before disclosure, then report ML5.3.** No further TRAIN tuning,
automatic ML5.4/ML6 work, live change or commit is included.

**ML5.3 resource follow-up (October 19, 2026):** the first guarded continuation
saved 30/100 outputs before the 80% memory guard interrupted A031 at 80.19%.
Both interrupted histories and all completed outputs remain intact; no answer
has been viewed or graded. Available memory returned to about 7.5 GiB after
unloading. A manually diagnosed resource-only amendment uses a fresh Python
worker and unloaded model for each remaining answer, a 4 GiB preload reserve,
the same 80% guard, and immediate unloading/worker exit between requests.
**32 focused model-free tests passed in 3.38 s.** The initial sandbox temporary
directory restriction was resolved by using a dedicated workspace test folder.
The remaining 70 approved outputs are now running under
`docs/ML53_ISOLATED_RECOVERY.md`; inference settings and the frozen sample are
unchanged. No automatic retry follows another failure. ML5.3 is still incomplete.

**ML5.3 explicit resource update (October 19, 2026):** Aditya requested four
threads, an 85% RAM threshold and 50% CPU limit. Eight isolated answers completed
before a clean pause at 38/100; no additional request failed. A separate sealed
adapter preserves all 38 outputs and both earlier failure histories. The final
62 use four threads, 85% sampled RAM stop, unloaded waiting at total CPU >=50%,
and six-of-twelve CPU affinity for the model, inherited before startup and
restored on the daemon after unloading. Other apps can make total CPU exceed
50%; the RAM guard is sampled. **40 focused tests passed in 3.77 s**; a lightweight
Windows probe verified affinity inheritance/restoration without model loading.
See `docs/ML53_RESOURCE_AMENDMENT.md`. The final continuation is running under
`ml/out/ml53_resource_completion/resumed/`; ML5.3 is not yet complete.

**ML5.3 completed (October 19, 2026):** all 100 planned outputs and ratings
are verified across 50 paired questions / six PDFs. Original twelve outputs
are unchanged; both interrupted request histories and administrative retries
are preserved. Ratings and a receipt were sealed before grading-time method
disclosure. One assistant reviewer, partial blinding, no human validation.
Pooled CE/ranker correctness **1.760 / 1.800**, difference **+0.040
[-0.200, 0.275]**; grounding **1.500 / 1.580**, difference **+0.080
[-0.067, 0.267]**. Both correctly abstain on 9/10 unsupported questions;
neither abstains on an answerable question. No reliable method gain follows.
Keep the preregistered ML5.2 decision: cross-encoder default, selector deferred.

Successful thread counts are 2/36/62 at two/three/four threads. Final 62 use
fresh workers, unload after every answer, 85% sampled RAM stop and a 50%
model CPU affinity ceiling. Peak RAM **79.67%**; whole-laptop CPU reached
100%, so a 50% total-system cap was not achieved. Model unloaded at finish.
The completion verifier validates all outputs/ratings and 64 prior immutable
checkpoints; focused resource suite 40 passed, actual viewer parser and six
session tests passed. See `docs/ML53_COMPLETION_RESULTS.md` and aggregate
reports `ml/results/ml5_answer_grading.json` / `ml/results/ml53_generation_complete.json`.
**Next: ML5.4 synthesis and final ML5 decision log, separately requested.**
No further TRAIN tuning, model workload, default change or commit is included.
Earlier progress notes above are historical checkpoints.

**ML5.4 synthesis completed (October 19, 2026):** consolidated TRAIN
ablations, both frozen retrieval collections, all 100 answer ratings and
optional TRAIN latency/context studies. Tables come from saved aggregate
JSON; no model, question-file read, retrieval or regrading. Recorded exact
metrics, the recomputed failed switch checks, final decisions and hashes of
17 preserved inputs in `ml/results/ml5_closeout.json`. The report and decision
log are `docs/ML5_SYNTHESIS.md`.

**Final ML5 verdict:** OKF concepts help pooled CE MRR on the six studied
TEST PDFs, **+0.0370 [0.0040, 0.0742]**, without a universal/all-metric claim.
Full-ranker primary MRR difference is **-0.0029 [-0.0551, 0.0385]**; retain
cross-encoder. Links show no pooled gain. Optional prompt/context candidates
remain deferred after correctness regressions. Answer quality differences
remain uncertain; the pretrained local LLM was not trained in ML5. Resource,
latency, citation and mathematical limitations remain documented.

**ML5 is complete, with the user's delegated-review amendment.** No deployment
readiness or independent human validation follows. Recommended next is
**ML7 write-up** (cards, results and README); **ML6 remains optional** and
requires its own TRAIN calibration/validation plan, without reopening the
consumed frozen tests. Neither next phase nor a commit is included here.
Earlier ML5 progress/next-step statements are historical checkpoints.

Closeout verification: **532 Python tests passed in 78.02 s**, six grading
session tests and actual packet parser passed; 17 source hashes, 42 numeric
table rows and all 64 prior immutable checkpoints validate. Initial sandbox
socket-pair stalls were resolved using local test socket permissions. One
investigated joblib warning reflects missing `wmic` physical-core lookup,
falling back to logical cores; it does not affect the saved results.

### ML6 — Answerability gate (Nov 10–16) · optional

**Scope clarification, October 20, 2026:** the user wants PDF-supported
answers for document questions and pretrained general knowledge for unrelated
questions. ML6 should route answer sources, not always refuse when evidence
is weak. General answers must be distinguished from PDF-grounded answers;
mere presence of retrieved chunks is insufficient. The existing prompt allows
general answers, but response metadata/citations currently do not reliably
distinguish their provenance. See `docs/ML6_ROUTING.md` (local notes, not in the repository). The user chose labelled
general knowledge when a related question lacks PDF support, and explicitly
requires visible **From PDF** / **General knowledge** labels. Mixed responses
must label sections separately, with citations only on PDF-supported content.
No live change, fitting or inference has started. Relatedness is distinct from
the existing answerability labels. Next is ML6.1 protocol and TRAIN-label audit.

- Calibrated logistic regression on retrieval features (top scores, gap,
  agreement); LightGBM comparison.
- Threshold chosen as a Neyman–Pearson problem: false-answer rate ≤ α.
- "Not found in this PDF — search all open PDFs?" state in the assistant.

**Acceptance:** AUROC, calibration error, risk–coverage curve; replaces the
fixed threshold in `validator.py`.

### ML7 — Write-up (Nov 17–23)

- Results tables, model card, dataset card, decision log.
- Rewrite `README.md` and `PROJECT_SUMMARY.md` (local notes, not in the repository); mark
  `docs/CLOUD_ARCHITECTURE.md` (since removed) historical.
- Buffer for end-semester exams.

**Completed October 19, 2026:** after committing ML5 as `30be3a0`
(`Complete ML5 answer evaluation and final synthesis`), consolidated the
cross-phase results, model and dataset cards, decisions and reproduction
limits in `docs/ML7_RESULTS.md`, `docs/MODEL_CARD.md`, `docs/DATASET_CARD.md`
and `ml/results/ml7_documentation.json`. Rewrote README for native-text find,
optional CPU/local services, embedded Qdrant and manually started Ollama.
Rewrote `PROJECT_SUMMARY.md` (local notes, not in the repository), marked the cloud
proposal historical and routed old ML READMEs to the current cards.

The write-up distinguishes weak-label development, repeated/adjudicated
classifier diagnostics, first-read versus post-fix OKF checks, the single
frozen retrieval milestone and 100 assistant-reviewed answers. No new model
load, training, raw label/question-file read, inference or UI operation.
25 aggregate/source/artifact input hashes are recorded. ML6 stays optional;
no calibration, latency, human-validation or deployment claim was added.
Verification details are recorded in the ML7 documentation index and log.

**Verification:** 25 aggregate/source/artifact hashes, 25 numerical table rows
and 24 local links validate; documented command paths/defaults match source.
The ML5.3 integrity verifier still passes with 100 outputs and 64 immutable
checkpoints. Three unrelated files are preserved byte-for-byte. The preceding
532 Python / six grading-session tests remain the unchanged-code baseline;
no model, UI or full-suite rerun was needed for documentation. Diff whitespace
checks pass. ML7 was ready for review at this checkpoint; the user subsequently
requested its documentation commit.

**Next after the requested ML7 checkpoint:** earlier reader/chrome manual
acceptance and static-demo publication remain
open. Optional ML6 or another latency/grounding phase needs a separate request
and new validation plan. No automatic further tuning or publishing.

---

## 4. Known constraints

- Weak labels cover only formatted headings: 114 definitions, 347
  theorem-type, 252 proofs, 245 examples, 122 algorithms, 5 notation. Prose
  definitions are measured only through the hand-labelled set.
- 10 groups have no headings at all (payments papers, non-maths documents);
  they supply "other" examples and unanswerable questions.
- Scanned PDFs (`use = scan-slice`) have no reliable text and are out of the
  ML track until an OCR phase is planned.
