# TRAIN context-budget quality screen — October 18, 2026

Status: **all twelve TRAIN answers have been reviewed and scored**. The
smaller budget worsened one paired answer and fails the predeclared screen,
despite retaining every reference quote. The budget proposal is on hold;
live settings stay unchanged. The separate frozen answer-quality experiment
remains paused at 12/100, with 88 unstarted answers.

## Purpose and fixed design

The latency probe found prompt processing used 85.8% of full-context request
time in two stress cases. Smaller inputs were faster, but all outputs hit a
128-token cap and quality was unassessed. This next screen checks whether the
proposed smaller budget removes evidence or weakens answers.

- Six fresh AI-authored, answerable questions over three TRAIN PDFs.
- Native source evidence: seven page/quote checks, including one question
  requiring two definitions. Questions are simple source lookups/comparisons,
  not representative traffic or independently authored evaluation data.
- File groups must belong to the frozen TRAIN split before PDF/bundle reads.
  Neither original question file nor frozen grading inputs are opened.
- Use the service's actual ingestion, hybrid+concept retrieval and CE reranker
  on an in-memory index: 24 candidates, top eight contexts, scoped to one PDF.
  No model fitting, link expansion or persistent-index writes.
- Compare the same larger/smaller budgets as the probe: at most eight context
  items / 18,000 UTF-8 text bytes versus three items / 4,000 bytes. Both are
  capped; the larger variant is not an uncapped live baseline.
- Same qwen2.5:3b-instruct digest, Ollama 0.40.4, three CPU threads, zero GPU
  layers, 32K allocation and temperature 0.1. **Both use a 512-token output
  cap**, restoring the existing grading cap. Length stops are retained.
- Twelve answers total, presented in a fixed shuffled order with opaque IDs.
  Gold references do not enter prompts except when naturally retrieved as
  source text; packing never uses gold labels to select or reorder evidence.

References are descriptions from existing TRAIN concepts, checked as literal
substrings of their physical PDF pages after removing whitespace. Native
extraction explicitly expands typographic ligatures such as `ﬁ` to `fi`,
using [PyMuPDF's extraction flags](https://pymupdf.readthedocs.io/en/latest/app1.html#text-extraction-flags-defaults).
Case, punctuation and mathematical symbols stay unchanged. One initial
reference check failed solely due to this font representation; preparation
stopped before writing any study or loading models. All seven checks pass
with the explicit extraction setting. No fuzzy match or altered reference
was used to bypass validation.

The private study file SHA-256 is
`785b4538d30fe47772ad7c9194bb19abf4b89842ca448b4437a70174dd6924a4`.
Sources, PDFs/bundles, options and model identity are sealed. Ten protected
file hashes bind the existing grading checkpoint and completed latency probe.
Their sources and outputs remain unchanged.

Verification: **431 Python tests passed in 69.41 seconds** after the final
extraction change. Ten new synthetic tests cover evidence losses, scoped
contexts, blind exports, aggregate-only runtime output, failed/interrupted
attempts, complete-ratings scoring, TRAIN routing and native reference checks.
The sealed study check also passed. No frontend source changed; manual page
checks remain pending. Those checks preceded the approved workload below.

## Generation results

Exactly twelve answers completed, with no failed, unresolved or duplicate
attempts and no retries. All twelve stopped normally; **none hit the 512-token
cap**. Raw CE top-eight contexts and each packed budget retained every complete
reference for **6/6 questions**. No additional quote loss was observed from
either byte cap on this small screen.

| Mean over six requests per budget | Larger budget | Smaller budget |
| --- | ---: | ---: |
| First visible text | 59.5 s | 6.8 s |
| Request total | 69.2 s | 16.2 s |
| Server prompt processing | 59.4 s | 5.0 s |
| Server output generation | 9.8 s | 9.4 s |
| Prompt tokens | 1,780.7 | 787.0 |
| Output tokens | 77.7 | 85.2 |

Active retrieval/generation took **12m 23s**: about 3m 50s for retrieval/model
setup and 8m 33s for generation. These are generation-only request means for
six selected TRAIN questions, with uncontrolled cache/order effects and
different output lengths. They are not representative live-app timings or
proof of equal accuracy. Reference retention passed the preliminary lexical
check; the completed review below found an answer-quality regression. The
runtime report preserves its historical grading-pending status from generation
time; the final quality report now records the completed review.

Verification recomputed aggregate metrics from twelve unique completed
attempts and matched report/journal/packet/key hashes and the removed lock.
The actual grading parser accepted all twelve opaque answers and verified
their canonical packet hash in Node without a browser. All ten protected
hashes still match. The earlier 431-test suite applies; no implementation
changed after it. The user subsequently delegated grading to the assistant;
the review used files directly and did not operate the UI.

An initial service metadata timeout stopped before encoder loading, retrieval
or generation. The existing service responded on metadata-only rechecks, then
the approved run continued with matching model/version. The assistant did not
start or restart Ollama, and no generation attempt was repeated. Initial and
successful logs remain separate and ignored. Runtime report SHA-256:
`840d927f67e7046e3c920d16425c078f709626f0635c874150dd2bd594789629`.

## Evidence retention and answer grading

For each question, record whether **every complete reference quote** occurs
in one of the raw CE top-eight contexts, then in each packed variant. Matching
ignores whitespace only. This conservative lexical proxy can miss equivalent
wording or evidence split across contexts; it is not semantic correctness.
Separate existing retrieval misses, larger-budget losses and additional losses
from the smaller budget. Do not remove failed cases or use gold to repair them.

After all twelve answers finish, export a blind packet and a separate private
budget key. Reuse the unchanged offline grading page. Correctness and grounding
are each 0/1/2 under the existing rubric; answerable abstentions get correctness
zero. Rate the answers as generated, including any truncation, against both
the source reference and the supplied contexts. Budget names, scores and key
are absent from the packet, though context lengths may allow inference.

Public runtime output contains budget-level timing aggregates and evidence
counts only, with no answer IDs, row-order assignments, prompts or answers.
Complete all ratings before the scorer reads the private method key. It then
reports correctness/grounding, paired bounded-minus-full differences and
regression counts, with document-bootstrap intervals. Only three document
clusters make those intervals exploratory and potentially unstable.

Any additional evidence loss or graded regression blocks adopting this budget
from this screen. Passing six easy, answerable TRAIN questions still does not
establish noninferiority, safe abstention, broader task quality or suitability
for production. No default switch is automatic, and the frozen retrieval
decision remains cross-encoder by default.

## Completed review, methodology and decision

At the user's request, the assistant reviewed all twelve answers against the
gold references and their actual supplied contexts, without opening the private
budget key. All ratings/notes were saved and validated, then an immutable
receipt sealed their hashes before the key was read for paired scoring. The
title stays neutral; grading provenance is recorded in the methodology and
the report's `grading` metadata. This is not independent human validation.
The same assistant prepared the TRAIN questions, and context lengths/study
design were visible, so blinding is partial and reviewer independence limited.

Correct requested facts with only source-attribution errors retain correctness
credit but lose grounding credit. A materially incomplete comparison earns
partial correctness. A wrong central claim plus an explicit refusal on an
answerable question earns correctness/grounding zero. Redundant valid citation
numbers alone are not penalized. Full private rationales remain with the ratings.

| Score (0–2) | Larger budget mean [95% CI] | Smaller budget mean [95% CI] | Paired smaller minus larger [95% CI] |
| --- | --- | --- | --- |
| Correctness | 1.833 [1.500, 2.000] | 1.667 [1.000, 2.000] | -0.167 [-0.500, 0.000] |
| Grounding | 1.667 [1.000, 2.000] | 1.500 [0.500, 2.000] | -0.167 [-0.500, 0.000] |

One of six paired questions regressed on both metrics: a partial comparison
became an incorrect/unsupported answer with an invented notation equivalence
and unnecessary refusal despite available evidence. Another question had
incorrect citation attribution under both budgets. Exact reference retention
therefore does not guarantee sound synthesis or citation use.

**Decision: hold the three-item/4K-byte proposal.** The predeclared screen
blocks adoption after any paired regression. These exploratory intervals use
only three document clusters and include zero; they do not establish a
statistically significant population difference or a safe alternative. Live
defaults and the frozen retrieval switch decision remain unchanged.

Public aggregate result: `ml/results/context_quality_train.json`, SHA-256
`0bc80a5b21334b363217374158aeaf3746e25982efb9e2d081ff598e138d80f9`.
Private ratings: `ml/out/context_quality/ratings.assistant.json`, SHA-256
`2afb0621f081ce1749d261be215bda0195634231fe2835d1a667b707d0bb60a8`.
The receipt binds ratings, packet and rubric provenance. Paired metrics were
recomputed with the unchanged scoring function and matched the report. The
actual offline parser also validated all twelve saved ratings in Node; no UI
was operated and no user grading is required for this completed screen.
Protected experiment/source checks still pass. No model was loaded or answer
regenerated during review/scoring, and no sealed generation source changed.

## Workload and files

Preparation was light and loaded no models. The **completed workload was
explicitly approved**: rebuilding a three-document in-memory index with cached CPU
embedder/CE models, retrieving six questions, then generating twelve answers.
The pre-run allowance was **20–40 minutes, potentially longer**, with three-thread
limits; the successful active run took 12m 23s. Ollama must already be manually
running. A metadata-only identity check runs
before encoder loading; the runner never starts Ollama or downloads models.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.context_quality --run
```

Private files stay under ignored `ml/out/context_quality/`: study/reference
data, retrieval plan, generation journal/state, blind packet and private key.
Interrupted retrieval builds and failed/uncertain generation attempts block
automatic retries. A clean saved retrieval plan avoids rebuilding it on a
later resume, and completed answers are retained. Exclusive generation locks
and an immutable retrieval-start receipt prevent duplicate concurrent work.

Public runtime report: `ml/results/context_quality_train_runtime.json`.
Aggregate quality report after complete ratings:
`ml/results/context_quality_train.json`. Existing reports cannot be overwritten.
Raw answers, references, human ratings/notes and PDFs must not be committed.

## Optional grading-page workflow

The current review is complete by delegation; this checklist is retained for
later interface acceptance or another reviewer. It is not a pending step for
Aditya to perform in this screen. Interface behavior was not visually tested.

1. Open `ml/eval/grading.html` locally and load
   `ml/out/context_quality/blind_packet.json`. Expect twelve answers and no
   budget labels or retrieval scores. Do not open `private_key.json`.
2. Check that question, reference pages/quote and numbered contexts appear.
   Grade correctness, grounding and abstention, then save. Expected progress
   increases by one; Previous/Next preserves saved entries.
3. Export partial ratings after one answer, reload the page/packet and import
   them. Expect the saved rating/progress to return. This UI check remains
   pending until Aditya reports it; no UI automation has been performed.
4. Finish all twelve and export the final ratings JSON. Keep it under ignored
   `ml/out/context_quality/`; do not commit it. Score only the complete file:

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.context_quality --score ml/out/context_quality/ratings.json
```

**Next subphase:** revise the experimental context-packing/answer-grounding
approach to preserve complementary definitions and reduce off-topic/repeated
material, then recheck on TRAIN before any live budget decision. Packing must
use query/candidate information available at runtime, not gold references.
Broaden beyond these six easy answerable questions before generalizing. No
additional model workload is approved, and live streaming remains separately
scoped. The remaining 88 frozen grading answers and later ML5.4 synthesis are
still pending. The assistant can perform subsequent answer reviews under the
user's delegation; record the method truthfully rather than implying human
validation. Any amendment to the original frozen grading procedure must be
documented before that later review, without reopening frozen questions.
