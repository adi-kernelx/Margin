"""Apply an explicit CPU-thread amendment without rewriting the sealed ML5.3 plan.

Configuration is metadata-only. Generation still requires workload approval.
python -m ml.eval.answer_generation_resources --configure --threads 3
python -m ml.eval.answer_generation_resources --run --limit 10
"""

import argparse
import hashlib
import json
from pathlib import Path

from ml.eval import answer_generation as gen

PROFILE = "runtime_amendment.json"


def adapter_hash():
    return gen.sha256(Path(__file__))


def configure(threads, out=gen.OUT):
    if type(threads) is not int or not 1 <= threads <= 12:
        raise ValueError("CPU thread count must be an integer from 1 to 12")
    lock = out / "generation.lock"
    with lock.open("x", encoding="utf-8") as target:
        target.write(gen.now())
    try:
        plan = gen.load_plan(out)
        state = gen.read(out / "generation_state.json")
        journal = out / "answers.jsonl"
        if (state["status"] != "paused_between_batches" or state["plan_sha256"] != gen.digest(plan)
                or state["journal_sha256"] != gen.sha256(journal)):
            raise ValueError("Need an unchanged run paused between batches")
        answers = gen.journal_answers(journal, plan["records"], gen.digest(plan))
        if len(answers) != state["completed"] or not 0 < len(answers) < len(plan["records"]):
            raise ValueError("Need a partial, consistent saved-answer checkpoint")
        if threads == plan["options"]["num_thread"]:
            raise ValueError("Thread count already matches the sealed plan")
        profile = {"version": 1, "created_at": gen.now(),
                   "reason": "User requested CPU thread count; no answer-quality selection",
                   "plan_sha256": gen.digest(plan), "plan_file_sha256": gen.sha256(out / "plan.json"),
                   "adapter_sha256": adapter_hash(), "options": {**plan["options"], "num_thread": threads},
                   "retained_ids": sorted(answers), "journal_prefix_bytes": journal.stat().st_size,
                   "journal_prefix_sha256": gen.sha256(journal)}
        profile["amendment_sha256"] = gen.digest(profile)
        gen.write_new(out / PROFILE, profile)
        return profile
    finally:
        lock.unlink()


def load_amendment(plan, out=gen.OUT):
    profile = gen.read(out / PROFILE)
    unsigned = {key: value for key, value in profile.items() if key != "amendment_sha256"}
    threads = profile["options"].get("num_thread")
    if (profile["version"] != 1 or gen.digest(unsigned) != profile["amendment_sha256"]
            or profile["adapter_sha256"] != adapter_hash()
            or profile["plan_sha256"] != gen.digest(plan)
            or profile["plan_file_sha256"] != gen.sha256(out / "plan.json")
            or type(threads) is not int or not 1 <= threads <= 12
            or threads == plan["options"]["num_thread"]
            or profile["options"] != {**plan["options"], "num_thread": threads}):
        raise ValueError("Runtime amendment changed the plan or options beyond CPU threads")
    journal = out / "answers.jsonl"
    prefix_size = profile["journal_prefix_bytes"]
    if type(prefix_size) is not int or prefix_size < 1:
        raise ValueError("Invalid original journal boundary")
    with journal.open("rb") as source:
        prefix = source.read(prefix_size)
    if (len(prefix) != prefix_size or not prefix.endswith(b"\n")
            or hashlib.sha256(prefix).hexdigest() != profile["journal_prefix_sha256"]):
        raise ValueError("Original two-thread journal prefix changed")
    prior = [json.loads(line) for line in prefix.decode("utf-8").splitlines()]
    prior_ids = sorted(event["id"] for event in prior if event["status"] == "complete")
    if prior_ids != profile["retained_ids"] or not prior_ids:
        raise ValueError("Retained answer boundary changed")
    answers = gen.journal_answers(journal, plan["records"], gen.digest(plan))
    for item, event in answers.items():
        if item not in prior_ids and (event.get("runtime_options") != profile["options"]
                or event.get("runtime_amendment_sha256") != profile["amendment_sha256"]):
            raise ValueError("Later answer lacks the approved runtime amendment")
    return profile


class AmendedOllama(gen.Ollama):
    def __init__(self, plan, profile, out=gen.OUT, client=None):
        super().__init__(client)
        self.plan_hash, self.profile, self.out = gen.digest(plan), profile, out
        self.profile_file_hash = gen.sha256(out / PROFILE)

    def identity(self):
        if (gen.sha256(self.out / PROFILE) != self.profile_file_hash
                or adapter_hash() != self.profile["adapter_sha256"]):
            raise ValueError("Runtime amendment or adapter changed between requests")
        return super().identity()

    def answer(self, plan, record):
        if gen.digest(plan) != self.plan_hash:
            raise ValueError("Generation plan changed")
        result = super().answer({**plan, "options": self.profile["options"]}, record)
        return {**result, "runtime_options": self.profile["options"],
                "runtime_amendment_sha256": self.profile["amendment_sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--configure", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--threads", type=int)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.configure != (args.threads is not None):
        parser.error("--threads is required only with --configure")
    if args.limit is not None and (not args.run or args.limit < 1):
        parser.error("A positive --limit requires --run")
    if args.configure:
        profile = configure(args.threads)
    else:
        plan = gen.load_plan()
        profile = load_amendment(plan)
        if args.run:
            print(json.dumps(gen.execute(plan, limit=args.limit, engine=AmendedOllama(plan, profile)), indent=2))
            return
    print(f"CPU threads={profile['options']['num_thread']}; retained answers={len(profile['retained_ids'])}. "
          "No generation requested.")


if __name__ == "__main__":
    main()
