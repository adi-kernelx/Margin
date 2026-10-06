# ML Data Pipeline — Step 1: Block Extraction

Deterministic data-extraction pipeline that splits PDFs into text blocks,
extracts layout features, and assigns **weak labels** from headings
("Definition 2.1", "THEOREM 1.25", "Proof.", etc.).

No model training, no OCR, no LLM calls, no ML libraries.

## Quick start

```bash
# From repo root:
python ml/data/extract_blocks.py ^
  --manifest "Test PDFs/manifest.csv" ^
  --pdf-dir  "Test PDFs" ^
  --out      ml/out ^
  --only "Steepest_Descent_Method_23 rd March 2026.pdf" ^
         "2609.35896v1.pdf" ^
         "boneh franklin ibe.pdf" ^
         "NIST.FIPS.203.pdf" ^
         "Introduction to the theory of computation_third edition - Michael Sipser.pdf:53-100"
```

Run tests:
```bash
python -m pytest ml/tests/test_heading_rules.py -v
```

## Output files (in `ml/out/`)

| File | Description |
|------|-------------|
| `blocks_sample.jsonl` | One JSON object per block in document order |
| `report_sample.md` | Per-file stats, sample blocks, suspicious list |
| `overlays/<stem>_p<N>.png` | 3 pages per PDF with block bboxes coloured by label |

> **Note**: `ml/out/` is gitignored (contains copyrighted text).

## Block schema (JSONL)

```json
{
  "block_id": "sha256(file|page|idx)[:16]",
  "file": "...", "group": "...", "category": "...",
  "page": 12, "block_index": 3,
  "bbox": {"x0": 0.11, "y0": 0.42, "x1": 0.89, "y1": 0.51},
  "column": 0,
  "text": "...", "text_without_heading": "...",
  "n_lines": 4, "n_chars": 312,
  "font_size_median": 10.9, "font_size_rel": 1.0,
  "bold_ratio": 0.08, "italic_ratio": 0.21, "mono_ratio": 0.0,
  "math_char_ratio": 0.05,
  "indent_rel": 0.02, "gap_above_rel": 1.4,
  "weak_label": "theorem", "weak_subtype": "lemma",
  "heading_text": "Lemma 3.2", "heading_number": "3.2",
  "heading_name": null, "heading_evidence": ["regex", "terminator", "bold"],
  "possible_missed_split": false,
  "flags": []
}
```

### Weak labels

| Label | Subtypes |
|-------|----------|
| `definition` | definition, defn |
| `theorem` | theorem, lemma, corollary, proposition, claim |
| `proof` | proof |
| `example` | example, examples, exercise, problem |
| `notation` | notation |
| `algorithm` | algorithm |
| `other` | remark, note |
| `null` | no heading found (NOT "other") |

## Heading detection rules

- Only the **first line** of a block is inspected.
- A keyword must be followed by a terminator (`.` `:` `—`), end-of-line,
  bold, font change, or UPPER CASE — bare regex alone is not enough.
- "Theorem 2.1 shows that ..." is **not** a heading (continuation verb).
- "Note that ..." is **never** a heading.
- `text_without_heading` has the heading removed so a later model can't
  learn the regex shortcut.

## Known limitations

1. **Two-column detection** is a simple heuristic (>60% of lines wholly in
   one half). Complex layouts (3+ columns, side-notes) are not handled.
2. **Display equations** — the centred-math heuristic may fail on very short
   or very wide equations.
3. **Furniture detection** requires ≥30% page frequency; documents with
   varying headers across sections may retain some furniture.
4. **Heading name extraction** for "Proof of Theorem 2.1." treats "of
   Theorem 2.1" as the heading name, which is correct but may look odd.
5. **Beamer overlays** — incremental slides may produce near-duplicate blocks.

## Source-group split (ML1.4.1)

After the full extraction, run from the repo root:

```bash
python -m ml.data.make_splits
python -m pytest ml/tests -p no:cacheprovider
```

`ml/splits.json` contains the seed, frozen train/test/excluded groups,
per-split and per-group counts, and coverage warnings. It contains no block
text. The script reserves eight coverage groups and uses a seeded shuffle of
sorted remaining groups to fill the ten test places. Sipser and MA3204 stay
in train; Atangana's thesis/paper group is also reserved for train to retain
algorithm examples. Development folds will be drawn only from train groups in ML2.

The revised split was **accepted and frozen by the user on October 6, 2026**.
It records `status: frozen`, the acceptance date and the user's confirmation.
Keep its memberships fixed; tune models only on train/development sources.
The CLI generates proposals and uses
exclusive creation and refuses to overwrite an existing file, including an
accepted split. For a review candidate use `--out <different-path>`; do not
replace the accepted test set to improve model results.

The accepted split includes Oscar Levin's *Discrete Mathematics: An Open
Introduction*, third edition, fifth printing (2021), licensed CC BY-SA 4.0.
Source: https://discrete.openmathbooks.org/dmoi3.html
PDF: https://discrete.openmathbooks.org/pdfs/dmoi3-tablet.pdf
Downloaded October 6, 2026; SHA-256:
`9baf67f2ec90cf5020430bc502aa5aacad1cf482df47b1bb7495c02d3c9bf99e`.
The PDF is local and ignored by Git. To reproduce its extraction:

```bash
python ml/data/extract_blocks.py --manifest "Test PDFs/manifest.csv" --pdf-dir "Test PDFs" --out ml/out/levin --only Levin_Discrete_Mathematics_3rd_ed.pdf
```

The split command reads both the original `ml/out/full/blocks_sample.jsonl`
and `ml/out/levin/blocks_sample.jsonl`, preserving the original extraction.
If re-extracting every eligible PDF into one combined file, pass that file
alone using `--blocks <path>` to avoid duplicate IDs.
The textbook closes the document-type gap, but has no literal Definition
headings detected by the existing rules. Test has five weak-labelled definitions.
Unlabelled blocks remain unlabelled, and independent hand labels will measure
prose definitions. This proposal does not establish class-balanced evaluation.

## Independent hand labelling (ML1.4.2)

The sample is already generated at `ml/labels/to_label.jsonl`. Reproduction
command (refuses to overwrite an existing sample):

```bash
python -m ml.data.sample_for_labelling
python -m pytest ml/tests -p no:cacheprovider
node --test ml/tests/label_session.test.cjs
```

Use `--out <new-path> --report <new-path>` if an additional reproducibility
check is needed. Do not replace the sample partway through labelling.
The generator requires the frozen split and reads both extraction files.
The 300 inputs contain only block ID, filename, physical 1-based PDF page and
text: weak labels, heading evidence and sampling strata are omitted.

The diagnostic sample targets 100 heading-labelled blocks, 100 unlabelled
definition-like prose candidates and 100 remaining unlabelled blocks.
Within each stratum sources are visited in turn; weak-labelled queues also
distinguish weak class. Stratum shortages fill from unused eligible blocks.
This enriches rare concepts and limits dominant sources; it is not a uniform
population sample. Report later results as performance on an enriched test
sample, not an estimate of accuracy on every PDF block. Sampling counts live
in ignored `ml/out/labelling_sample_report.json`; do not consult weak classes
while assigning hand labels.

Blocks below 30 characters, explicitly flagged furniture/TOC and TOC entries
are skipped. Contents pages are inferred from five or more TOC entries across
stored lines, matching the extractor's threshold. Furniture already removed
by extraction stays absent; residual furniture that escaped those heuristics
can still need human review. Prose phrases include “we say”, “is called”,
“is said to be”, “denote” and “define”; a candidate is not a confirmed definition.

Double-click `ml/labels/label.html`; it runs locally without a server, build,
external fonts, dependencies or requests. Select `to_label.jsonl`. Label with
keys 1–7 or buttons; S skips, left/right move back/forward. Back does not undo
a label: choose another label to correct it. Skip removes any previous label
and leaves the block unresolved. Numbers typed while the file picker has focus
do not trigger labels; Tab to the page or click the block first.

Progress uses browser `localStorage` keyed by the complete dataset's content.
Reload and reselect the same sample to resume. Some browsers restrict storage
for local files/private mode; the page warns when saving fails. Export after
each session regardless: exported labels are a separate durable backup.
Restore exported labels validates every row before merging; foreign IDs,
invalid labels/timestamps and duplicate IDs are rejected.

Export downloads `hand_labels.jsonl` to your browser's download directory.
Move it to `ml/labels/hand_labels.jsonl` yourself. Only labelled blocks are
exported, each with `block_id`, `label` and `labelled_at`. Skipped blocks are
not exported, so completion means 300 labelled and zero unresolved blocks.
Both sample and hand-label JSONLs are Git-ignored; the HTML is committable.
Use the built-in label guide and the source PDF page for context. If extraction
is unreadable or mixed roles cannot be resolved, skip and review later.

### Manual acceptance (user; pending)

1. Open the HTML offline and load the sample. Expect “Block 1 of 300”, text,
   filename and page; no automatic label or sampling stratum.
2. Assign an appropriate label with a number key, then another with a button.
   Expect one advance per action and the labelled counter to increase.
3. Back to a labelled block and correct its label. Expect its selected button
   and “Your label” to change, with no duplicate counted label.
4. Skip a block. Expect the skipped count to increase and labelled count not
   to increase. Revisit and label it; skipped count should decrease.
5. Reload the page and reselect the same sample. Expect labels, skipped blocks
   and position restored, or a visible storage warning if your browser blocks it.
6. Export, then restore the exported file. Expect the same labelled count and
   labels; export includes no text, automatic labels or skipped records.
7. Try selecting an unrelated non-JSONL file. Expect an error with the previous
   sample still usable. Check Tab focus rings and narrow-window readability.

Manual checks and 300 completed human labels are still pending. Non-UI tests
execute the inline JavaScript in Node without a DOM; they do not validate
browser event wiring, downloads or rendering.

## Evaluation questions (ML1.4.3)

Follow `ml/eval/questions.schema.md` to write `ml/eval/questions.jsonl` yourself.
The real question file is Git-ignored; no 200-question gold set has been created.
Aim for 200 questions over about 15 PDFs, 8–15 per file, about 40 unanswerable,
covering train and test sources. Ask in your own words; copy only the supporting
quote. Use physical PDF pages starting at 1 and native text, not OCR.

```bash
python -m ml.eval.validate_questions
python -m ml.eval.validate_questions --require-complete
```

Partial collections are accepted by default. The completeness flag checks the
planned total and distribution. Both modes validate schema, unique IDs, source
identity, frozen split membership, PDF availability/page bounds and quotes on
listed pages. Quotes ignore whitespace only; incorrect punctuation/case and
ellipses are not silently repaired. An optional `split` must agree with the
frozen group; omitted values are derived internally as train/test. Questions
are never rewritten. Counts contain no question/quote text.

Review question quality and whether a negative really is unanswerable yourself;
quote presence cannot establish either. This validator does not run retrieval.

## Current retrieval baseline (ML1.4.4)

Five authored starter questions are now in ignored `ml/eval/questions.jsonl`;
the same five are in `ml/eval/questions.example.jsonl` for reproducible smoke
evaluation. Their quotes validate against local PDFs. This is not the planned
200-question collection: two train and three test questions, all answerable,
one per PDF. Expand and review the real collection before making quality claims.

```bash
python -m ml.eval.validate_questions
python -m ml.eval.baseline_current_rag --questions ml/eval/questions.example.jsonl --local-only
```

`--local-only` requires already cached models. Without it, sentence-transformers
may download named weights on first use. Existing dependencies are listed in
`ml/eval/requirements.txt`; none were installed for this run. Default input is
the real question file if present, otherwise the example. The explicit smoke
command keeps results marked `example_only: true`. Output:
`ml/results/baseline_current_rag.json`, aggregate numbers/configuration only.

Mechanism: native PyMuPDF word spans → imported legacy `chunk_spans` →
all-MiniLM-L6-v2 → exact cosine top 8 scoped to the named PDF →
ms-marco-MiniLM-L-6-v2 cross-encoder. No running Qdrant, Docker or LLM generation.
Ingestion now constructs its Qdrant client and imports the embedder on service
use, so importing the existing chunker does not connect or load models.

Recall@5 averages a binary gold-page hit among the first five chunks. MRR@10
uses the first gold-page match within ten ranks, but the legacy candidate budget
is eight, so ranks nine and ten cannot score. Reranking orders all eight before
limiting context to five. Unanswerable questions are counted but excluded from
these metrics. Complete PDFs, not just gold pages, are indexed.

Confidence intervals use 2,000 seeded bootstrap resamples of complete files,
keeping a document's questions together; means are question-weighted. Bounds
are interpolated 95% percentiles. Two or three example files per split cannot
support reliable quality conclusions, even with perfect scores.

Inherited differences and limits:

- Exact cosine replaces approximate HNSW; native spans replace OCR tokens.
- Whole paragraphs can exceed the nominal 800-character chunk cap. NIST has
  93 chunks, 57 above 800 characters (maximum 3,465); model token limits may
  truncate text. Chunking was preserved to measure existing behaviour.
- Ingestion stores `page`, while the old retriever reads `pageNumber`. That
  live-service mismatch remains unfixed. Offline evaluation uses actual chunk
  `page`: it does not validate live citation correctness.
- No models or frozen groups were tuned on smoke results.

Tests inject deterministic model outputs for metrics and exercise the actual
chunker on native PDF text. Bootstrap is handwritten in `ml/eval/stats.py`;
the separate smoke run checks actual pretrained model inference.
