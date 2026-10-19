# ML5.3 user-requested resource amendment — October 19, 2026

Aditya explicitly requested one additional CPU thread while away, then an
85% RAM threshold and 50% CPU limit. The current answer completed normally
before the change: 38/100 outputs are preserved. The controller was suspended
while its worker finished and unloaded, then stopped between requests. No
additional answer attempt was interrupted. Two earlier memory-related failed
attempts, A013 and A031, remain preserved and disclosed.

The previous isolated recovery completed eight fresh-worker answers (A031–A038)
and returned unloaded RAM to roughly 52% each time. The authoritative
continuation is now `ml/out/ml53_resource_completion/resumed/`. Copy its exact
38-answer successful prefix, original sealed plan and preparation, and existing
three-thread profile. A separate hash-bound four-thread amendment preserves
earlier provenance: two outputs with two threads, 36 with three, and the final
62 with four. No previous generation/recovery source, receipt or journal changes.

Keep one fresh worker and unloaded model per answer. The new resource policy
uses a 4 GiB unloaded-model reserve plus 15% physical-memory headroom, waits
unloaded if headroom is insufficient or sampled total CPU is at least 50%,
and stops verified model runners above 85% sampled physical-memory use. The
RAM guard samples every two seconds; it is not an absolute instantaneous cap
and cannot guarantee against hardware, thermal or power faults.

Enforce the model CPU ceiling with Windows CPU affinity. This laptop reports
12 logical CPUs; restrict the manually started Ollama daemon to six before
spawning the model, so its runner inherits a maximum of six schedulable CPUs.
Keep generation at four threads, verify runner affinity during work, and set
the runner Below Normal. Restore the daemon's exact original affinity after
unloading on every success/failure. Do not launch Ollama or alter unrelated
apps. The ceiling applies to the model process; other apps and the Python
controller can make whole-laptop CPU exceed 50%. No claim of a global OS CPU
cap follows. On a one-CPU system the affinity approach is rejected.

Keep the original model/version/digest, full saved contexts, QA/system prompts,
temperature 0.1, 512-token cap, 32K allocation and GPU 0. Only the explicitly
requested thread count and resource controls change. No frozen question file
is reopened, retrieval repeated, fitting/tuning performed or live default
changed. Cold model reloads, different thread counts/days/cache states, process
priority and CPU affinity make runtime comparisons descriptive only.

Any new failed or uncertain request stops without automatic retry. Do not read
any answer until all 100 complete. The unchanged 0–2 rubric and full-before-
disclosure review protocol in `docs/ML53_ASSISTANT_REVIEW.md` still apply, with
this authoritative path and all resource amendments disclosed. Save/validate
all opaque ratings before method disclosure. Use truthful assistant-review
metadata and no human-validation claim. Keep the frozen retrieval decision.
ML5.4 synthesis follows separately; no further experiment or commit is included.
