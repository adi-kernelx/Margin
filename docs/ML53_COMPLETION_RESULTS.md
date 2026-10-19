# ML5.3 saved-context answer evaluation

Completed October 19, 2026. All **100 planned answers / 50 paired questions /
six source PDFs** are generated, reviewed and verified. The original twelve
outputs are retained exactly; the approved continuation supplied eighty-eight.
The cross-encoder remains the default. ML5.4 synthesis is next and has not run.

## Scope and review

The fixed sample contains 25 original and 25 independent questions, each with
20 answerable and five unanswerable cases. Each question has a cross-encoder
and seed-0 full-ranker answer. Generation used the sealed saved contexts;
neither frozen question file was reopened and retrieval was not repeated.
No training, live default change, new context tuning or commit was performed.

Aditya delegated review to the assistant. All opaque answers were compared
with their supplied contexts and saved references under the original 0–2
correctness and grounding rubric. Complete ratings were saved and validated,
then an exclusive receipt was written **before grading-time method/key
disclosure**. Ratings were not changed after disclosure. Metadata explicitly
records `reviewer: assistant` and `human_validation: false`; there was one
reviewer and partial blinding, without independent human validation.

## Answer quality

Scores below are means out of two, not accuracy percentages. Differences are
ranker minus cross-encoder. Intervals are 95% percentile bootstrap intervals
from 2,000 whole-document resamples, seed 20261006; pooled resampling keeps
both question collections from each source PDF together.

| Sample | Questions per method | CE correctness | Ranker correctness | Difference [95% CI] | CE grounding | Ranker grounding | Difference [95% CI] |
|---|---:|---:|---:|---|---:|---:|---|
| Original | 25 | 1.800 | 1.760 | -0.040 [-0.211, 0.125] | 1.440 | 1.560 | +0.120 [-0.091, 0.423] |
| Independent | 25 | 1.720 | 1.840 | +0.120 [-0.182, 0.400] | 1.560 | 1.600 | +0.040 [-0.095, 0.154] |
| Pooled | 50 | 1.760 | 1.800 | +0.040 [-0.200, 0.275] | 1.500 | 1.580 | +0.080 [-0.067, 0.267] |
| Answerable only | 40 | 1.725 | 1.775 | +0.050 [-0.244, 0.343] | 1.400 | 1.500 | +0.100 [-0.077, 0.333] |
| Unanswerable only | 10 | 1.900 | 1.900 | 0.000 [0.000, 0.000] | 1.900 | 1.900 | 0.000 [0.000, 0.000] |

Pooled CE correctness CI is [1.609, 1.900], ranker [1.521, 1.979]; grounding
CIs are [1.364, 1.608] and [1.368, 1.738], respectively. Full unrounded
estimates and per-set/answerability intervals are in
`ml/results/ml5_answer_grading.json`.

Both methods attempted all 40 answerable questions: **zero unwanted
abstentions**. Both refused all ten unanswerable questions, but one refusal
per method added unsupported speculation, so **correct abstention is 9/10
(90%, CI [72.7%, 100%])**, not 10/10. It is 4/5 original and 5/5 independent
for both methods; the latter's degenerate bootstrap interval does not imply
population certainty.

The small pooled point gains do not establish a reliable improvement: all
correctness and grounding difference intervals above include zero. Errors
include wrong mathematical/security details, units or table columns,
incomplete definitions and unsupported additions. Citation failures include
missing attribution, correct facts linked to an adjacent irrelevant chunk,
and original bibliography numbers copied as supplied-context markers.
No frozen output was repaired or regenerated based on quality.

The preregistered ML5.2 retrieval switch failed before this answer review.
These secondary results do not reverse that decision or justify promoting
the experimental context selector. ML5.4 should synthesize existing evidence
and record the decision; further model execution is outside this completion.

## Generation and resource history

Model: `qwen2.5:3b-instruct`, Ollama 0.40.4, digest
`357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b`.
Original QA/system prompts, temperature 0.1, output cap 512, context allocation
32768 and CPU-only execution were preserved. Successful-output provenance is
**two with two threads, 36 with three, 62 with four**.

Two administrative requests were interrupted: original A013 after the user's
memory/shutdown concern, then guarded A031 when the earlier 80% RAM threshold
was crossed at 80.19%. Both histories remain intact; neither partial answer
was saved or inspected. There were **100 successful requests, two interrupted
requests and two administrative retries**. A clean pause at 38 completed
outputs introduced the user-requested four-thread/resource amendment without
an extra failed generation.

The final seventy successful requests used a fresh Python worker and unloaded
model per answer, including eight three-thread and 62 four-thread requests.
The final amendment reserved 4 GiB plus 15% physical RAM before loading,
waited unloaded at total CPU >=50%, sampled RAM every two seconds and stopped
only verified model runners above 85%. Six-of-twelve logical CPU affinity
restricted model execution; daemon affinity was restored after unloading.

| Stage | Successful new outputs | Peak sampled RAM | Peak sampled total CPU | Outcome |
|---|---:|---:|---:|---|
| First guarded continuation | 18 | 80.19% | 83.3% | Stopped at earlier 80% RAM threshold |
| Fresh workers, three threads | 8 | 74.57% | 100.0% | Completed; model unloaded after each |
| Fresh workers, four threads | 62 | 79.67% | 100.0% | Completed; model unloaded after each |

Final-stage minimum available memory was 3.12 GiB. The model's CPU affinity
ceiling is **50% of laptop logical CPU capacity**, not a whole-system cap:
other applications/Python can raise total CPU above 50%, and total-system
samples did reach 100%. Their precise attribution is unproven. The RAM guard
is a sampled stop threshold, not an instantaneous allocation cap or assurance
against thermal, power or hardware faults. The model was unloaded at finish;
a subsequent lightweight check measured 58.2% RAM / 6.41 GiB available.

Successful request time totals 3h 47m 54s; mean 136.7 s, median 117.9 s,
range 28.9–396.8 s. These exclude interrupted requests, waiting, unloading
and review. Final 62-worker continuation elapsed 2h 12m 38s including its
overhead/waits. All saved responses report stop reason `stop`. Different
questions/output lengths, thread settings, priority, cache states, fresh
loads and generation days prevent a controlled speed or method comparison.
These timings are not interactive end-to-end latency guarantees.

## Verification and limitations

- Pre-recovery full model-free suite: 516 passed in 122.37 s, no warnings.
- Resource-amendment focused suite: 40 passed in 3.77 s; Windows lightweight
  child verified CPU-affinity inheritance/restoration without inference.
- Completion verifier independently recomputed quality estimates/intervals,
  validated all 100 outputs/ratings, 50 pairs/six PDFs, exact retained prefixes,
  both failed histories, 70 isolated workers, final-worker affinity records,
  source seals and all 64 immutable prior checkpoints.
- Actual offline-viewer parser accepted the packet hash and all 100 ratings;
  all six parser/session tests passed. No UI operation was required.

Only six source-document clusters, one output per method/case, a selected
50-question sample and one assistant reviewer limit generalization. Questions
were AI-authored; original questions followed retrieval development, while
the independent collection was authored blind. Mathematical extraction and
question/reference wording ambiguities remain in the private rationales;
they were not corrected after observing outputs. Intervals are descriptive,
not independent confirmation of deployment quality.

Public aggregate artifacts: `ml/results/ml5_answer_grading.json` and
`ml/results/ml53_generation_complete.json`. Final private packet, journal,
ratings, rationales, key, source seals and receipts remain under ignored
`ml/out/ml53_resource_completion/`; earlier recovery folders remain intact.
The final aggregate JSONs and rating receipt have independently verified
hashes. No raw questions, answers or document passages belong in a commit.
