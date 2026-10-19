# ML5.3 delegated answer review — October 19, 2026

Aditya explicitly delegated grading to the assistant and requested completion
of ML5.3. This replaces the human/UI reviewer step only; preserve the frozen
sample, original QA/system prompts, model and 0–2 rubric. Use a neutral result
title with truthful assistant-review metadata and `human_validation:false`.
No manual grading or UI operation is required from Aditya. ML5.4 synthesis
remains the following separately requested subphase.

The original sample contains 50 frozen questions, 20 answerable and five
unanswerable from each collection, with two method answers each. Use only the
completed saved-context packet. Do not reopen either original question file,
repeat retrieval, extract new test cases or tune anything on these results.
No scoring or condition disclosure until all 100 answers are complete and
all 100 ratings have been saved/validated. Ratings must not change afterward.

The interrupted original A013 attempt is preserved in the failed journal.
The authorized memory-safe continuation keeps the original twelve completed
outputs byte-for-byte and completes the same planned 100 outputs in a separate
ignored folder. Document the administrative retry, mixed two/three-thread
provenance, memory guard, low process priority and separate generation days.
No claim of zero attempted failures or controlled cross-method runtime follows.

Review opaque outputs against the question, supplied contexts and saved gold:

- Correctness 0/1/2: incorrect/unsupported central answer; partially correct or
  materially incomplete; accurate and complete. Use the preregistered rule
  of zero correctness for an answerable abstention and two for a justified
  unanswerable abstention.
- Grounding 0/1/2: unsupported central claim; mixed support/citation errors;
  all substantive claims supported with appropriate attribution. A correct
  unsupported-question refusal without fabricated facts earns two.
- Keep correctness separate from actual citation support. A true fact found
  elsewhere in the pool can lose grounding when attributed to the wrong
  source. Repetition alone is cosmetic. Accurate page/title attribution can
  count even without bracket-number syntax.
- Accept a concise, complete answer without requiring every gold clause.
  Penalize incomplete requested classifications and substantive unsupported
  additions. Straightforward deductions from cited evidence are allowed;
  incorrect central mathematical expressions are not rescued by incidental
  correct terminology.
- Record abstention separately. A contradictory absence claim followed by a
  substantive partial answer is mixed, not complete abstention. For a truly
  justified context-limited refusal on an answerable question, distinguish
  zero answer correctness from support for the refusal; explain the case in
  its private rationale. Never repair an answer or gold label after seeing it.
- Preserve truncation and source-extraction/label ambiguity and document them.
  Single-reviewer judgments are not independent human validation.

Save complete ratings to ignored storage. The wrapper validates completeness
and packet/state hashes, writes an exclusive hash receipt, then reads the
condition-bearing plan/private key. It calls the existing frozen grading
functions and reports original/independent, pooled and answerability strata,
paired differences and whole-document 95% bootstrap intervals. Keep both
collections' questions from the same PDF together. Report answerable unwanted
abstentions and correct abstention on the ten negative questions per method.

Six source-document clusters, one output per method/case, a small selected
sample, one assistant reviewer, partial blinding and AI-authored questions
limit generalization. The original questions were authored after retrieval
development; the independent collection was authored blind. Retain both
collections separately and never change the frozen retrieval switch rule
based on answer grading.

Private review helpers, packet, ratings, rationale, key and receipts stay in
`ml/out/ml53_completion/`. Eligible public artifacts are aggregate numerical
results plus methodology/limitations only. Do not commit raw answers, source
quotes, original question files, private keys or model artifacts.
