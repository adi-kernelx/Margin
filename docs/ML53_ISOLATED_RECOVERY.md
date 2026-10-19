# ML5.3 isolated resource recovery — October 19, 2026

The first guarded continuation stopped at 80.19% physical-memory use during
A031. Thirty original outputs completed, including eighteen of the approved
remaining 88; the original twelve remain byte-identical. The failed A031 has
no saved output and no answer content has been inspected. The previous worker
and model exited; available memory returned to about 7.5 GiB, around 51% use.
Memory rose gradually during the long-lived run. The measurements establish
resource accumulation across the run, but do not identify its exact owner.

The guard stopped automatic recovery as specified. After manual diagnosis,
the assistant prepared this resource-only amendment under Aditya's explicit
instruction to finish ML5.3 unattended. The previously approved 88-answer
workload still covers the remaining seventy planned outputs. This is a second
administrative recovery due to measured resource pressure, never answer quality.

Preserve the two failed journals and receipts without alteration. Copy only
the successful thirty-answer byte prefix into a new ignored directory,
`ml/out/ml53_isolated_completion/resumed/`, with the exact original sealed plan,
preparation and existing three-thread amendment. Hash-link both histories.
The pending A031 is a disclosed administrative retry. No partial output is
read. Do not claim zero request failures or first-attempt success throughout.

Each remaining answer runs in a fresh Python subprocess, with an initially
unloaded model. Require 4 GiB model reserve plus 20% physical-memory headroom
before loading; wait unloaded if insufficient, or total CPU is at least 65%.
Use the existing two-second memory guard, 80% emergency stop and Below Normal
priority targeting only verified children of the manually started Ollama.
After each answer, request prompt-free unloading, verify that model runners
exit, and end the worker. Keep per-answer resource logs. Any new failure stops
this run without automatic retry. Never start Ollama or close unrelated apps.
These sampled controls cannot guarantee against hardware, thermal or power faults.

Keep the original model/version/digest, full saved contexts, QA/system prompts,
temperature 0.1, 512 output-token cap, 32K allocation, CPU-only execution and
approved three threads unchanged. No retrieval, fitting, frozen question-file
read, tuning, output replacement or live-default change occurs. Cold workers
and model reloads further limit runtime comparisons. The first two original
answers used two threads; the other 98 use three.

The review procedure in `docs/ML53_ASSISTANT_REVIEW.md` still applies, with
two resource interruptions/retries and this authoritative continuation path.
Review no answer until all 100 complete. Save and validate every opaque rating
before condition disclosure. Preserve honest assistant-review metadata and no
human-validation claim. Report both collections, pooled paired estimates and
document-bootstrap intervals; keep the frozen retrieval decision unchanged.
ML5.4 follows separately. No new TRAIN experiment or commit is authorized.
