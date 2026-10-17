"""ML4.4: paired train-only one-hop expansion, three fixed ranking seeds.

Uses live fill/retrieval/CE and the existing leave-one-document-out evaluator.
No LLM, test evaluation, model saving or parameter selection.

    python -m ml.eval.link_expansion_eval --out ml/results/link_expansion_train.json
"""

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from ml.eval.baseline_current_rag import ROOT
from ml.eval.live_rag_eval import CANDIDATES, fill, load_questions
from ml.eval.metrics import METRICS
from ml.eval.ranker_eval import METHODS, candidate_group, cross_validate, summarise, validate_cached_groups
from ml.eval.stats import document_bootstrap
from ml.ranking.features import FEATURES
from ml.ranking.ranker import PARAMS
from ml.retrieval.links import LINK_LIMIT, SEED_COUNT

SEEDS = (0, 1, 2)
VARIANTS = {"off": "hybrid_concepts", "on": "hybrid_concepts_links"}


def candidate_key(item):
    return (item.get("kind"), item.get("pdfFingerprint"), item.get("conceptPath"), item.get("page"),
            item.get("text"), repr(item.get("bbox")))


def build_groups(questions):
    import retriever
    from reranker import get_cross_encoder
    from schemas import QueryScope

    groups = {variant: [] for variant in VARIANTS}
    diagnostics = []
    for number, question in enumerate(questions, 1):
        pools = {variant: retriever.retrieve(question["question"], CANDIDATES,
                 QueryScope(docIds=[question["file"]]), method) for variant, method in VARIANTS.items()}
        # Each unique text gets one CE logit shared between the paired pools.
        texts = list(dict.fromkeys(item["text"] for items in pools.values() for item in items))
        logits = get_cross_encoder().predict([[question["question"], text] for text in texts]) if texts else []
        if len(logits) != len(texts):
            raise ValueError("Cross-encoder returned the wrong number of logits")
        scores = dict(zip(texts, map(float, logits)))
        row = {"file": question["file"], "qid": question["qid"]}
        for variant, items in pools.items():
            for item in items:
                item["cross_encoder"] = scores[item["text"]]
            group = candidate_group(question, items)
            groups[variant].append(group)
            row[variant] = {"candidates": len(items), "candidate_hit": float(any(group["labels"])),
                            "linked": sum(bool(item.get("reached_by_link")) for item in items)}
        off_items = {candidate_key(item) for item in pools["off"]}
        row["new_candidates"] = sum(candidate_key(item) not in off_items for item in pools["on"])
        diagnostics.append(row)
        print(f"Candidates {number}/{len(questions)}", flush=True)
    return groups, diagnostics


def paired_results(off, on):
    reference = {row["qid"]: row for row in off}
    if len(off) != len(on) or set(reference) != {row["qid"] for row in on}:
        raise ValueError("Paired results must contain the same questions")
    report = {}
    for method in METHODS:
        report[method] = {}
        for metric in METRICS:
            by_file = defaultdict(list)
            for row in on:
                base = reference[row["qid"]]
                if row["file"] != base["file"]:
                    raise ValueError("Paired document mismatch")
                by_file[row["file"]].append(row[method][metric] - base[method][metric])
            report[method][metric] = document_bootstrap(by_file)
    return report


def average_seeds(runs):
    """Average per-question outcomes first, then bootstrap whole documents."""
    indexed = [{row["qid"]: row for row in rows} for rows in runs]
    if not indexed or any(set(run) != set(indexed[0]) for run in indexed):
        raise ValueError("Seed results must contain the same questions")
    rows = []
    for qid, first in indexed[0].items():
        if any(run[qid]["file"] != first["file"] for run in indexed):
            raise ValueError("Seed document mismatch")
        row = {"qid": qid, "file": first["file"]}
        for method in METHODS:
            row[method] = {metric: float(np.mean([run[qid][method][metric] for run in indexed])) for metric in METRICS}
        rows.append(row)
    return rows


def signature(questions, args):
    paths = ["ml/retrieval/links.py", "ml/retrieval/hybrid.py", "ml/ranking/features.py",
             "ml/eval/live_rag_eval.py", "ml/eval/ranker_eval.py", "ml/eval/link_expansion_eval.py",
             "local-llm/rag-api/retriever.py", "local-llm/rag-api/concepts_api.py"]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.encode())
        digest.update((ROOT / path).read_bytes())
    # Hash only the selected training documents and their bundles.
    import re
    for file in sorted({q["file"] for q in questions}):
        digest.update(file.encode())
        digest.update((args.pdf_dir / file).read_bytes())
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file).stem)[:80]
        bundle = args.bundles / stem
        for path in sorted(bundle.rglob("*.md")):
            digest.update(path.relative_to(bundle).as_posix().encode())
            digest.update(path.read_bytes())
    digest.update(json.dumps(questions, sort_keys=True).encode())
    return {"version": 1, "sha256": digest.hexdigest(), "features": list(FEATURES),
            "candidates": CANDIDATES, "seed_count": SEED_COUNT, "link_limit": LINK_LIMIT}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", type=Path, default=ROOT / "ml/eval/questions.jsonl")
    parser.add_argument("--pdf-dir", type=Path, default=ROOT / "Test PDFs")
    parser.add_argument("--bundles", type=Path, default=ROOT / "ml/out/bundles")
    parser.add_argument("--groups", type=Path, default=ROOT / "ml/out/link_expansion_groups.json")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--require-cache", action="store_true")
    parser.add_argument("--frozen-test-milestone", action="store_true")
    args = parser.parse_args()
    if args.frozen_test_milestone:
        raise SystemExit("Frozen tests require the ML5 inference-only evaluator; this command fits models")
    if args.require_cache and not args.groups.is_file():
        raise SystemExit("--require-cache needs an existing candidate cache")
    questions, splits = load_questions(args)
    if splits != {"train"} or not questions:
        raise SystemExit("Need answerable training questions only")
    provenance = signature(questions, args)
    if args.groups.exists():
        cache = json.loads(args.groups.read_text(encoding="utf-8"))
        if cache["signature"] != provenance:
            raise SystemExit("Candidate cache is stale; use a new --groups path to rebuild")
        groups, diagnostics = cache["groups"], cache["diagnostics"]
        for variant in VARIANTS:
            validate_cached_groups(groups[variant], questions)
    else:
        from embedder import get_embeddings
        fill(sorted({q["file"] for q in questions}), args.pdf_dir, args.bundles, get_embeddings)
        groups, diagnostics = build_groups(questions)
        args.groups.parent.mkdir(parents=True, exist_ok=True)
        args.groups.write_text(json.dumps({"signature": provenance, "groups": groups, "diagnostics": diagnostics}),
                               encoding="utf-8")
    runs, per_seed = {variant: [] for variant in VARIANTS}, {}
    for seed in SEEDS:
        for variant in VARIANTS:
            results, _ = cross_validate(groups[variant], seed=seed)
            runs[variant].append(results)
        per_seed[str(seed)] = {variant: summarise(runs[variant][-1]) for variant in VARIANTS}
        per_seed[str(seed)]["paired_on_minus_off"] = paired_results(runs["off"][-1], runs["on"][-1])
        print(f"Completed leave-one-document-out seed {seed}", flush=True)
    averaged = {variant: average_seeds(runs[variant]) for variant in VARIANTS}
    report = {"questions": len(questions), "documents": len({q["file"] for q in questions}), "splits": ["train"],
              "signature": provenance, "ranker": PARAMS, "seeds": list(SEEDS), "per_seed": per_seed,
              "seed_mean": {variant: summarise(averaged[variant]) for variant in VARIANTS},
              "paired_on_minus_off": paired_results(averaged["off"], averaged["on"]),
              "questions_with_new_candidates": sum(row["new_candidates"] > 0 for row in diagnostics),
              "mean_new_candidates": float(np.mean([row["new_candidates"] for row in diagnostics])),
              "questions_with_linked_candidates": sum(row["on"]["linked"] > 0 for row in diagnostics),
              "mean_linked_candidates": float(np.mean([row["on"]["linked"] for row in diagnostics])),
              "candidate_recall": {variant: document_bootstrap({file: [row[variant]["candidate_hit"]
                  for row in diagnostics if row["file"] == file] for file in sorted({q["file"] for q in questions})})
                  for variant in VARIANTS}}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for variant in VARIANTS:
        for method in METHODS:
            values = report["seed_mean"][variant][method]
            print(variant, method, " ".join(f"{metric} {v['value']:.3f} [{v['ci95'][0]:.3f}, {v['ci95'][1]:.3f}]"
                                          for metric, v in values.items()))
    print("Paired on minus off:", json.dumps(report["paired_on_minus_off"]))


if __name__ == "__main__":
    main()
