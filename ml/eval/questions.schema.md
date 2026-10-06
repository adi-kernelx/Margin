# Evaluation questions — ML1.4.3

Write `ml/eval/questions.jsonl`: one JSON object per physical line, no enclosing
array. UTF-8; blank lines are allowed. This file is Git-ignored because quotes
can contain text from private/copyrighted PDFs. You write the real questions.

## Fields

| Field | Required value |
|---|---|
| `qid` | Unique nonempty ID, e.g. `q001` |
| `file` | Exact filename from `Test PDFs/manifest.csv` |
| `group` | Exact source group from that manifest |
| `question` | Nonempty question in your own words |
| `answer_pages` | Distinct positive integers: physical PDF pages starting at 1 |
| `answer_quote` | A contiguous supporting excerpt from one listed page |
| `type` | `definition`, `theorem-lookup`, `needs-definition`, `explain`, `other` |
| `answerable` | JSON `true` or `false`, not a string |
| `split` | Optional `train` or `test`; validator derives it from the frozen group and rejects a supplied mismatch |

Other fields are rejected to catch typos. For an unanswerable question use
`answer_pages: []` and `answer_quote: ""`. A supporting quote is mandatory for
an answerable question. Quote matching ignores whitespace but preserves case,
punctuation, hyphens and mathematical symbols. Do not put `...` into a quote
unless those characters actually occur in the PDF. A quote cannot span pages.
Copy it from the PDF's native text layer, not OCR. If extraction differs from
the visual mathematics, find a readable supporting prose excerpt; do not edit
the evidence to make validation pass.

Printed page labels often differ from physical pages because of front matter.
Use the physical file page: e.g. a book's printed page 27 may be PDF page 43.
List all pages that can support a correct retrieval hit, checking each manually.
The validator checks every page is in bounds and the quote occurs on at least
one; it cannot prove that every other listed page answers the question.

## Example (unanswerable)

```json
{"qid":"q001","file":"Design_Brief_Relationship_Design_Challenge_2026.pdf","group":"design-brief","question":"What constraint qualification guarantees the KKT conditions?","answer_pages":[],"answer_quote":"","type":"other","answerable":false,"split":"test"}
```

This illustrates the format, not an independently verified gold question.
For an answerable item fill the same fields with the question, physical pages
and exact supporting quote after checking the PDF. No fake quote template is
included that could be mistaken for verified evidence.

## Writing the collection

- Aim for 200 questions across about 15 PDFs, 8–15 per PDF, covering independent
  train and test groups. A workable allocation is 10 PDFs × 13 questions and
  5 PDFs × 14 questions. Include the independent textbook, papers, slides,
  NIST and non-maths documents; several test groups are preferable to just one.
- About 40 should be unanswerable in the **named PDF**, not just absent from
  the page currently open. Check the document before declaring absence. Asking
  a design brief about KKT conditions is a useful negative only after verifying
  that it does not answer that question.
- Write natural questions in your own words before copying the evidence quote.
  Copying a sentence and deleting one term unfairly favours keyword retrieval.
- `definition`: asks what a concept means. `theorem-lookup`: asks for a result
  or its conditions. `needs-definition`: answering requires connecting a result
  with a definition. `explain`: asks for explanation grounded in the PDF.
  `other`: other tasks or unrelated negative questions.
- Keep train/test sources fixed. Later tuning may use train questions; reserve
  test questions for evaluation milestones. Do not improve questions after
  seeing which retrieval system gets them wrong merely to improve its score.

## Validation

From the repository root:

```powershell
python -m ml.eval.validate_questions
python -m ml.eval.validate_questions --require-complete
```

The first command validates a partial collection so you can work incrementally.
The second also requires exactly 200 questions, 13–17 PDFs, 8–15 questions per
PDF, 35–45 unanswerable questions, and both train/test sources. These ranges
make “about 15” and “about 40” explicit; they are collection checks, not scores.

Output contains counts by type, file, split and answerability, followed by
`VALID` or `INVALID`; exit code is 0 for success and 1 for errors. Errors use
physical JSONL line numbers. Scanned/excluded files are rejected. Files are
read only, and no question or quote text is printed in reports.

The validator proves schema/source/page/quote consistency. It does not judge
the correctness, completeness or difficulty of your questions or confirm that
an unanswerable question is truly unanswerable. No retrieval baseline runs here.
