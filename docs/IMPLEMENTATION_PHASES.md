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

**Progress (Oct 14):** ML3.1 done: bundle writer, links, conformance checker; all 48 main PDFs build conformant bundles (2,245 concepts, 6,587 links). ML3.2 (Oct 14): `POST /bundle` on the RAG service; title/link gold check (held-out: concept precision 0.93, titles good 0.75 / usable 0.92, link precision 0.76); fallback concepts dropped (1,188 concepts, 1,591 links); hand-written BM25 + RRF hybrid retrieval with harness (smoke run only, 2 questions). ML3.3 (Oct 14): Knowledge panel in Margin (build, filter, jump to region, Verify into OKF `verified` + log, export zip), standalone `/bundle` server without Docker. ML3.4 (Oct 14): 200 evaluation questions (VALID; 40 unanswerable; 120 train / 80 test); on the train split hybrid RRF beats dense retrieval (paired MRR@10 +0.101 [+0.024, +0.178]) and hybrid + OKF concepts beats it on both Recall@5 (+0.074) and MRR@10 (+0.117). ML3 complete; next ML4 (learned ranker).

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

- LightGBM ranking (LambdaRank) over passages and concept files.
- Features: BM25, vector similarity, cross-encoder score (as a feature), term
  and maths-token overlap, block type, is-concept, is-verified, reached by
  one-hop link, distance to the page being read.
- One-hop link expansion: a retrieved theorem brings the definitions it uses.
- Replaces fixed top-8 vector search and the web-trained reranker in
  `local-llm/rag-api`.

**Acceptance — demo milestone:** chat answers cite definitions and pages;
Recall@5 / MRR / nDCG table against all baselines.

### ML5 — Ablations and error analysis (Nov 3–9)

- OKF on/off; link expansion on/off; feature groups.
- McNemar on Recall@5; bootstrap by document for MRR/nDCG; blind hand-grading
  of ~100 answers.
- Break down definition-dependent versus other questions.

**Acceptance:** ablation table with intervals and a written verdict on whether
OKF helps (reported either way).

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
