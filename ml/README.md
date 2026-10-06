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
