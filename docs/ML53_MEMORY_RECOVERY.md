# ML5.3 memory interruption and continuation — October 19, 2026

Aditya approved the remaining 88 original frozen answers and assistant review
of all 100. Ollama initially refused the metadata connection; no generation
started. After manual startup, the first pending request A013 began. Aditya
then reported 87% RAM and prior laptop shutdowns under heavy load. The model
runner was stopped to release memory. No new answer completed; all twelve
retained answers remain byte-identical. A013 has a started/failed record and
no saved output. The original failed journal and state must never be erased.

After Aditya closed Claude and explicitly asked to continue unattended,
available RAM increased to approximately 7.35 GiB of 15.34 GiB. A prompt-free
unload cleared Ollama's stopped-model entry. This is a resource constraint
recovery, not selection based on answer quality. No partial output was viewed.

`ml/eval/memory_safe_completion.py` copies the exact original sealed plan,
preparation and three-thread amendment into a separate ignored continuation
folder, together with only the byte-identical successful twelve-answer prefix.
The original interrupted files stay unchanged and a hash-bound recovery record
explicitly links them. A013 is an administrative retry after user authorization;
do not claim that every request succeeded on its first attempt. The planned
100 final outputs, original contexts, prompt/system, model/version, temperature,
512-token cap and 32K allocation are unchanged. Two retained outputs use two
threads; the other 98 use the existing approved three-thread amendment.

Resource controls add no inference instruction or token/context change:

- Reserve 3.5 GiB for an unloaded model and require projected available RAM
  of at least 20% of physical memory before starting an answer.
- Check available RAM and total CPU between answers; wait and unload the idle
  model if headroom is insufficient or total CPU is at least 85%.
- Check physical RAM every two seconds during work. If usage exceeds 80%,
  stop only verified child model runners of the manually started Ollama process.
  Preserve the interrupted attempt and stop automatic recovery.
- Set verified runner priority to Below Normal. Never close unrelated apps,
  start Ollama or change its generation settings.
- Run one retained answer per durable batch so a normal wait occurs between
  answers without damaging a partially completed journal. Keep a resource-event
  log and report peak memory/minimum available memory.
- Request prompt-free model unloading after completion or failure.

These controls reduce resource pressure but cannot guarantee against hardware,
power or thermal faults. Sampling is periodic; it is not an absolute memory
cap. Process-priority changes and interruptions limit timing comparisons.

Private snapshot/interruption/recovery/event files stay under
`ml/out/ml53_completion/`; the authoritative continued answers and eventual
blind packet/key are under `ml/out/ml53_completion/resumed/`. Original frozen
input files are not reopened; the runner uses existing sealed saved contexts.
No retrieval, fitting, tuning or live-default change is included.

After all 100 answers complete, the assistant reviews the complete opaque
packet using the unchanged rubric. Save/validate every rating before a hash
receipt and grading-time condition disclosure. Results use a neutral title,
truthful assistant-review metadata, no human validation and explicit partial
blinding/shared-authorship limitations. Report original/independent and pooled
paired correctness, grounding and abstention with whole-document intervals.
Do not modify the frozen retrieval switch rule. ML5.4 follows separately.

Before preparing the continuation, the full model-free suite passed **516
tests in 122.37 seconds, no warnings**. Recovery/resource/grading checks also
passed as a focused 24-test group. Synthetic tests verify preload reserve,
high-memory stop targeting only the actual Ollama child, background priority,
CPU-pressure waiting, preservation of original failed history and exact
successful-prefix copying. No UI operation is included.
