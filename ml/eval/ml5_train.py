"""ML5.1 TRAIN ablations and artifact freeze; never reads frozen evidence.

    python -m ml.eval.ml5_train --out ml/results/ml5_train.json
"""

import argparse
import json
from pathlib import Path

from ml.eval.baseline_current_rag import ROOT
from ml.eval.live_rag_eval import CANDIDATES, fill, load_questions
from ml.eval.link_expansion_eval import average_seeds, build_groups, signature
from ml.eval.ml5_protocol import BASELINE, ML4_MODEL_SHA256, PRIMARY, RETRIEVAL, SEEDS, VARIANTS, sha256, source_hashes
from ml.eval.ml5_report import report, summarise
from ml.eval.ml5_scoring import predict_group
from ml.eval.ranker_eval import validate_cached_groups
from ml.ranking.features import FEATURES
from ml.ranking.ranker import PARAMS, load, save, train


def cross_validate(groups, questions, seed):
    lookup = {q["qid"]: q for q in questions}
    results = {qid: {"qid": qid, "file": q["file"], "type": q["type"], "set": "train"}
               for qid, q in lookup.items()}
    for held in sorted({q["file"] for q in questions}):
        for name, spec in VARIANTS.items():
            pool = groups[spec["pool"]]
            training = [g for g in pool if g["file"] != held]
            model = train(training, seed=seed, features=spec["features"]) if spec["kind"] == "ranker" else None
            for group in (g for g in pool if g["file"] == held):
                results[group["qid"]][name] = predict_group(group, spec, model)
    return list(results.values())


def freeze_models(groups, questions, artifact_dir, baseline_model, provenance):
    import joblib
    baseline = joblib.load(baseline_model)
    if baseline.get("splits") != ["train"] or baseline.get("questions") != len(questions):
        raise ValueError("Primary ML4 artifact must have matching TRAIN-only metadata")
    model = load(baseline_model)
    if tuple(model.margin_features_) != FEATURES:
        raise ValueError("Primary artifact must use all original features")
    models = {}
    for name, spec in VARIANTS.items():
        if spec["kind"] != "ranker":
            continue
        models[name] = {}
        for seed in SEEDS:
            if name == PRIMARY and seed == 0:
                path = baseline_model
            else:
                path = artifact_dir / f"{name}_seed{seed}.joblib"
                save(train(groups[spec["pool"]], seed=seed, features=spec["features"]), path,
                     questions=len(questions), splits=["train"], seed=seed, variant=name)
            models[name][str(seed)] = {"path": path.resolve().relative_to(ROOT).as_posix(),
                                      "sha256": sha256(path), "features": spec["features"]}
    protocol = {"version": 1, "status": "frozen", "seeds": list(SEEDS), "features": list(FEATURES),
                "variants": VARIANTS, "sources": source_hashes(), "models": models,
                "train_questions": len(questions), "train_files": sorted({q["file"] for q in questions}),
                "params": PARAMS, "primary": PRIMARY, "baseline": BASELINE, "training_signature": provenance}
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "protocol.json").write_text(json.dumps(protocol, indent=2) + "\n", encoding="utf-8")
    return protocol


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--groups", type=Path, default=ROOT / "ml/out/ml5_groups.json")
    parser.add_argument("--artifact-dir", type=Path, default=ROOT / "ml/models/artifacts/ml5")
    parser.add_argument("--baseline-model", type=Path, default=ROOT / "ml/models/artifacts/ranker.joblib")
    parser.add_argument("--questions", type=Path, default=ROOT / "ml/eval/questions.jsonl")
    parser.add_argument("--pdf-dir", type=Path, default=ROOT / "Test PDFs")
    parser.add_argument("--bundles", type=Path, default=ROOT / "ml/out/bundles")
    parser.add_argument("--frozen-test-milestone", action="store_true")
    parser.add_argument("--require-cache", action="store_true")
    args = parser.parse_args()
    if args.frozen_test_milestone:
        raise SystemExit("This command fits models on TRAIN; use milestone_eval for the frozen read")
    if args.require_cache and not args.groups.is_file():
        raise SystemExit("--require-cache needs an existing cache")
    if args.out.exists():
        raise SystemExit("Result file already exists; choose a new --out path")
    if sha256(args.baseline_model) != ML4_MODEL_SHA256:
        raise SystemExit("Primary model must retain the frozen ML4 seed-0 artifact")
    if (ROOT / "ml/models/artifacts/ml5/frozen_test_receipt.json").exists():
        raise SystemExit("Frozen milestone already claimed; do not refit or replace the frozen protocol")
    if (args.artifact_dir / "protocol.json").exists():
        raise SystemExit("Protocol already frozen; use a new artifact directory for a separate TRAIN experiment")
    args.include_unanswerable = True
    all_questions, splits = load_questions(args)
    questions = [q for q in all_questions if q["answerable"]]
    if splits != {"train"} or not questions:
        raise SystemExit("Need answerable TRAIN questions")
    provenance = {"candidates": signature(questions, args), "trainer": sha256(Path(__file__)), "retrieval": RETRIEVAL}
    if args.groups.exists():
        cache = json.loads(args.groups.read_text(encoding="utf-8"))
        if cache["signature"] != provenance:
            raise SystemExit("Stale candidate cache; use a new --groups path")
        groups = cache["groups"]
        for pool in RETRIEVAL:
            validate_cached_groups(groups[pool], questions)
    else:
        from embedder import get_embeddings
        fill(sorted({q["file"] for q in questions}), args.pdf_dir, args.bundles, get_embeddings)
        groups, _ = build_groups(questions, RETRIEVAL)
        args.groups.parent.mkdir(parents=True, exist_ok=True)
        args.groups.write_text(json.dumps({"signature": provenance, "groups": groups}), encoding="utf-8")
    runs = []
    for seed in SEEDS:
        runs.append(cross_validate(groups, questions, seed))
        print(f"Completed TRAIN ablations, seed {seed}", flush=True)
    # average_seeds supports a methods argument; every declared variant is paired.
    averaged = average_seeds(runs, methods=tuple(VARIANTS))
    source_by_qid = {row["qid"]: row for row in runs[0]}
    for row in averaged:
        source = source_by_qid[row["qid"]]
        row.update(type=source["type"], set="train")
    counts = {"train": {"total": len(all_questions), "answerable": len(questions),
                         "unanswerable": len(all_questions) - len(questions)}}
    output = {"splits": ["train"], "seeds": list(SEEDS), "signature": provenance,
              "per_seed": {str(seed): report(rows, counts) for seed, rows in zip(SEEDS, runs)},
              "seed_mean": report(averaged, counts),
              "feature_ablation_paired_vs_full": summarise(averaged, baseline=PRIMARY)}
    protocol = freeze_models(groups, questions, args.artifact_dir, args.baseline_model, provenance)
    output["protocol_sha256"] = sha256(args.artifact_dir / "protocol.json")
    output["primary_model"] = protocol["models"][PRIMARY]["0"]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(f"Saved TRAIN report and frozen protocol: {args.artifact_dir / 'protocol.json'}")


if __name__ == "__main__":
    main()
