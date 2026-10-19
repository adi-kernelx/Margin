# Margin dataset card

Recorded October 19, 2026. This describes several distinct collections used
for block understanding, OKF checks, retrieval and answer review. Counts are
from saved manifests/reports; ML7 did not read either frozen question file,
raw label file, generated answer packet or PDF text.

## Inventory and splits

| Collection | Size / unit | Purpose |
|---|---|---|
| Local PDF manifest | 58 entries: 48 main, six scan slices, four other | Source inventory; not 58 scored retrieval documents |
| Frozen original source split | 23 TRAIN / 10 TEST / five excluded groups | Group-disjoint block development and evaluation |
| Split snapshot | TRAIN 40 files/10,010 blocks; TEST 12 files/4,227 blocks | Native extraction counts at split freeze; later expansion is separate |
| Expanded weak-label training | 4,477 usable rows, 124 usable groups | Classifier training/development |
| Expansion inventory | 120 new papers; 143 total training groups, 124 usable | Adds source diversity without changing original TEST groups |
| Reliable negatives | 4,264 unheaded blocks | Final stacked classifier negative training signal |
| Definition-detector sentences | 458 positive / 16,098 negative | D2 sentence-level detector training |
| Enriched block diagnostic gold | 300 blocks / 12 PDFs | Roles and contains-definition evaluation |
| OKF first held-out item sample | 85 concepts / 41 links across 32 PDFs | Concept/title/link quality after development |
| Original retrieval questions | 200 total: TRAIN 120, TEST 80 | 95/25 answerable/unsupported TRAIN; 65/15 TEST |
| Independent retrieval questions | 78 TEST: 62 answerable/16 unsupported | Blind-authored wording; shares six answerable PDFs with original TEST |
| Frozen answer-review subset | 50 questions / six PDFs / 100 answers | 20 answerable + five unsupported from each collection, two methods |

The source-group split was accepted/frozen October 6, 2026, seed 20261006.
It prevents source variants from crossing train/test. Original split files
include six excluded scan slices; only reliable native text enters the ML
track. The manifest includes papers, slides, textbooks, notes, assignments,
standards and other documents. It is a local convenience collection, not a
random sample of academic PDFs, languages or future user traffic.

## Extraction and weak supervision

`ml/data/extract_blocks.py` extracts native text, font/layout features,
physical 1-based pages and normalized bounding boxes. Headings supply noisy
labels: definition, theorem-type, proof, example, notation, algorithm and other.
Unlabelled is not automatically other. Training strips heading text to avoid
the classifier learning that shortcut; explicit heading rules remain a separate
pipeline component. Role scoring merges notation into definition and excludes
other from macro F1. Heading rules, column grouping, equation layout and PDF
text order can be wrong; conformance validates structure, not semantic truth.

Expanded data use inverse usable-row source weights rather than an arbitrary
per-source cap. Vocabularies/preprocessing and grouped stacking fit training
folds only. Five source folds support classifier development; ranker development
instead leaves out one whole answerable document at a time. Do not mix these
different fold protocols or compare changing-row scores as identical-data gains.

## Annotation provenance and repeated reads

The 300-block sample contains 100 headed/weak strata, 100 definition-like prose
and 100 other unlabelled blocks. This enrichment prevents interpreting its
accuracy as the proportion correct over all PDF blocks. Two AI annotators
labelled it; the first adjudicated the 85 disagreement blocks (44 for B, 38
for A, three mixed), retaining 215 agreements. Role kappa is 0.806 (0.826
after role merging); contains-definition kappa is 0.645. There is no independent
human validation. The classifier has two disclosed milestone reads; the later
adjudicated report is a re-score of fixed model outputs against changed labels,
not a fresh untouched test. Do not reopen it to choose new thresholds.

The OKF first held-out item check is distinct from a source-disjoint ML test:
it excludes development concepts/links, not necessarily all their source PDFs.
It was assistant-labelled by one reviewer. Two issues exposed there were fixed
after that read; the final-build score therefore is not an untouched held-out
estimate. Report the first-read and post-fix rows separately. Carrying labels
across bundle rebuilds can drop items; keep the changed denominators explicit.

## Retrieval questions and answer review

The original 200 questions were AI-authored after retrieval development, which
can favor its wording. The independent 78 were authored blind by another AI;
this gives wording diversity, not new independent source PDFs or human ground
truth. Saved records include question identity, source, type, answerable flag,
gold pages and a supporting quotation. Quote matching checks source presence,
not question clarity or global unanswerability. Mathematical extraction and
reference wording ambiguities remain documented rather than repaired on TEST.

Both frozen collections were read once at ML5.2 on October 17, with an exclusive
milestone receipt. It evaluated fixed saved models without fitting and saved
contexts for later generation. ML5.3 consumed those contexts; it did not reopen
question files or repeat retrieval. The answer sample was fixed without seeing
method outcomes (sampling seed 20261017); opaque answer IDs/presentation used
seed 20261018. One assistant reviewed all 100, partially blinded, sealing
ratings before grading-time method disclosure. It is not human/interrater
validation. Two resource-interrupted requests and administrative retries are
preserved; there was no quality-based retry or post-disclosure rating revision.

Retrieval metrics exclude unsupported questions. Answer-review metrics include
them, distinguish answerable abstentions and correct negative refusals, and
score correctness/grounding on 0–2. These are different denominators: 127
answerable retrieval cases versus 50 paired answer-review cases. Uncertainty
resamples whole source PDFs (2,000 draws, seed 20261006); pooled sets share six
document clusters. Few clusters, one output per condition, selected questions
and unadjusted exploratory contrasts limit generalization.

## Access, rights and retention

Publicly committable material is code, source metadata, annotation guidance,
protocols and aggregate results. Local excluded material includes:

- `Test PDFs/` PDF bytes and source archives.
- `ml/out/` extracted/source text, bundles, frozen receipts, context packets,
  generated answers, ratings, private keys and local verification records.
- `ml/labels/*.jsonl` and `ml/labels/second_annotator/`.
- `ml/eval/questions.jsonl` and `ml/eval/questions_independent.jsonl`.
- `ml/models/artifacts/`, including learned text vocabularies.

Rights vary by document; no blanket redistributable dataset license is asserted.
Availability of a PDF or source archive does not grant rights to redistribute
its text. Obtain lawful copies/permissions separately. Do not commit raw quotes,
private documents, academic/personal details or generated packets. Learned
artifacts may retain vocabulary from the sources and are also excluded.

Source content stays local under the default runtime; configuring a remote
embedding/LLM endpoint changes that boundary. Browser IndexedDB, local Qdrant
and experiment files have separate lifecycles; clearing one does not erase the
others. No automatic remote backup or account-based access control is supplied.

## Reproduction and future use

Source identities/groups are in `Test PDFs/manifest.csv` and `ml/splits.json`.
Aggregate/source hashes and exact selected counts are indexed in
`ml/results/ml7_documentation.json`; that index contains no question/answer text.
Commands scattered through earlier logs are historical, not instructions to
repeat consumed milestones. No raw question file is needed to verify the saved
aggregate tables. Frozen sets must not be reopened for another evaluation,
training, seed/threshold selection or tuning. Future independent claims require
new validation data and a preregistered plan; model work also needs laptop
approval. See [model card](MODEL_CARD.md) and [results](ML7_RESULTS.md).
