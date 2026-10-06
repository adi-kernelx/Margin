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

- Train on `text_without_heading` so the model cannot learn the heading regex.
- Baselines: majority class; headings only (the regex).
- Models: TF-IDF + logistic regression; multinomial Naive Bayes; LightGBM with
  layout features (bold ratio, relative font size, indent, maths-character
  ratio, gap above, slide/paper/textbook category).
- Grouped cross-validation on train groups; cap each group's contribution
  (Sipser and the MA3204 slides hold 64% of weak labels).
- Own BM25 implementation (for ML3).

**Acceptance:** per-class F1 with bootstrap intervals on the hand-labelled
test set; recall on prose definitions reported separately; error analysis of
50 mistakes.

### ML3 — OKF bundle and hybrid retrieval (Oct 20–26)

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
