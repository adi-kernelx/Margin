# ML5.3 — Blind answer generation and human grading

Procedure fixed October 18, 2026, after checkpoint `3f5d0f3`. See the
implementation log for generation/grading status. Never reopen the original frozen question files or
repeat retrieval; use the receipt-bound saved inputs only.

## Fixed generation procedure

The saved sample has 50 questions, 20 answerable and five unanswerable from
each set. Each receives one CE-context answer and one original ML4
seed-0-ranker-context answer, making 100 answers. The existing QA prompt and
strict document-QA system message remain unchanged. Gold quotes, answer
pages and answerability judgments are not included in LLM prompts.

The private plan preserves the original records' order, creates CE then
ranker records for each question, shuffles with Random seed 20261018 and
assigns opaque A001–A100 IDs. Generation follows that same shuffled order.
This operational ordering is fixed before any LLM answer is seen. Do not
select or regenerate answers based on quality.

Runtime clarification, fixed before generation: local `qwen2.5:3b-instruct`,
temperature 0.1, maximum 512 output tokens, two CPU threads, zero GPU layers,
one request at a time and a 32,768-token context window. Saved prompts range
from 3,943 to 27,171 characters; the maximum combined prompt/system UTF-8
length is 27,752 bytes. A conservative byte/token bound plus 1,024 tokens
for output and chat-template overhead fits this window. Model-native
tokenization is not run during preparation. This explicit context-window
setting was absent from the earlier protocol; it accommodates the fixed
inputs for both methods, without changing their prompts or top-eight
contexts. It is not a claim of parity with the live app's unspecified
context-window default. No LLM outputs have informed these settings.

The native [Ollama chat API](https://docs.ollama.com/api/chat) exposes generation
options and completion/token metadata; the [official API source](https://github.com/ollama/ollama/blob/main/api/types.go)
defines the CPU/thread and context options. The adapter keeps the frozen
QA messages, temperature and output cap while specifying resource limits.
The installed model manifest digest is pinned; running Ollama must advertise
that same digest. If a local wrapper references another manifest, preparation
accepts its advertised digest only after verifying the referenced blob hash
and identical model/system/template/license layers and config; it also seals
the wrapper file hash. Ollama version is recorded before the first answer and
must match across later batches. No conversation history, tools, external
server, model download or Ollama startup is performed by these commands.

Temperature 0.1 generation remains run-specific; no generation seed was
preregistered. Preserve that noise rather than selecting among repeated
answers. Record token counts and stop reasons, including length-limited
answers, without quality-based retries. Requests have a 600-second timeout.

## Prepare, check and generate

Run from the repository root with `.venv-ml\Scripts\python.exe`:

```powershell
python -m ml.eval.answer_generation --prepare
python -m ml.eval.answer_generation --preflight
python -m ml.eval.answer_generation --run --limit 2
# Only after approval for the remaining workload:
python -m ml.eval.answer_generation --run
```

Preparation writes immutable private plan/seal files under
`ml/models/artifacts/ml5/grading/`. It validates the completed milestone,
input hashes, sample balance, source PDF identity and the unchanged frozen
code. It loads no model. Preflight performs metadata GETs against an already
running loopback Ollama; it does not start a server or generate text.

The first two answers can serve as a retained timing check: they count
toward the same 100 and are not extra trials. Obtain CPU approval before
any `--run`. Allow roughly 3–10 minutes for this timing batch; the full run
may take approximately 1–3 hours on two CPU threads, pending measurement.
Prompt length, cold loading and output length make the estimate uncertain.
If Ollama is unavailable, the user must start it manually before generation.

An exclusive lock prevents concurrent runs. A durable journal records each
attempt before its request and flushes each completed answer to disk.
Normal batch limits pause between answers; resuming skips completed IDs.
A failed request, unresolved attempt, corrupt journal, changed model/server
version or stale lock requires diagnosis. Do not delete journals, blindly
retry an uncertain request or replace an answer. A response cut off at the
512-token cap is retained and graded as produced.

Only after all 100 answers complete are `blind_packet.json` and
`private_key.json` exported, with content hashes in generation state. The
packet contains the question, answer, sanitized supplied contexts and gold
evidence. It excludes method names, qids, collection tags and retrieval
scores. **Do not open the private key or plan while grading.**

## Human grading

Open `ml/eval/grading.html` locally, then load `blind_packet.json`. The page
validates the packet's content hash before using cached ratings. No data is
sent over a network. It uses the existing labelling tool's visual style;
generic design-system search layouts did not fit this review workflow.
Local UI/UX guidance informed focus, labels, validation and readable controls.

Use the rubric registered in `ML5_PROTOCOL.md`:

- Correctness 0/1/2: incorrect or unsupported / partly correct or incomplete /
  accurate and complete. A justified abstention earns 2 on an unanswerable
  question and 0 on an answerable one.
- Grounding 0/1/2: unsupported central claim / mixed support or citation
  errors / all substantive claims supported with appropriate citations.
  A correct abstention without fabricated claims earns 2.
- Record whether the answer abstains, on every question. For unanswerable
  questions also record correct abstention yes/no; for answerable ones that
  field is N/A. Correct abstention requires abstained=yes and both scores=2.

Save each rating. Draft edits survive navigation in the same tab but do not
count as completed or enter exports until saved. Saved judgments use browser
storage; if storage is blocked/full the page warns explicitly. Export a JSON
backup frequently and before closing. Load the same packet and restore that
backup to move browsers. Notes are private and excluded from aggregate results.

Manual UI checks (pending; Aditya performs these). Before real answers exist,
use the explicitly synthetic `ml/out/ml53_practice_packet.json` to practice;
its ratings are separate and cannot score the real study.

1. Load the packet: a question/answer, gold evidence and expandable numbered
   contexts appear, with no method names or retrieval scores.
2. Submit empty choices: an announced, focused error appears and progress
   does not increase. Contradictory abstention ratings are rejected.
3. Save one judgment, navigate back and edit it: the saved count stays one.
   Draft edits survive navigation; only saved ratings enter exports.
4. Export a backup and reload the same packet: saved judgments restore.
   Importing another packet's backup must fail without replacing current data.
5. Check narrow-window layout, keyboard focus and long text wrapping. The
   form remains usable without horizontal scrolling.

## Score after every answer has been graded

```powershell
python -m ml.eval.answer_grading --ratings ml/out/ml5_ratings.json --out ml/results/ml5_answer_grading.json
```

Save the exported ratings at the chosen ignored path first. The scorer
requires complete, unique, valid ratings for all 100 opaque IDs before
calculating method comparisons. It verifies packet/key hashes and restores
question pairs using the private key internally. It reports each collection
and pooled results, answerability strata, correctness/grounding means,
abstention counts and paired differences with 2,000 document-bootstrap
resamples (seed 20261006). Both methods and both collections' questions from
the same PDF stay together. Scores 0/1/2 remain on their original scale.

This is a small preselected sample and one human grader. Report descriptive
results and limitations; do not revise the frozen retrieval switch rule or
claim independent confirmation. Do not commit prompts, packets, answers,
ratings, notes or private keys. Only code/docs and numerical aggregate results
are eligible for a later user-requested commit.

**Next after ML5.3:** ML5.4 synthesis of retrieval and completed human grading,
with a final ML5 decision log. ML6 answerability gating is optional and
requires its own scope decision; do not start it automatically.
