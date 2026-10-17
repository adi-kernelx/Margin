"""ML4: learned re-ranker vs the live cross-encoder, leave-one-document-out.

Candidates are the live service's 24 hybrid + concept candidates per question
(ml/eval/live_rag_eval.py setup). Hyperparameters are fixed in advance, not
tuned. Train split only; the frozen milestone needs a separate inference-only
evaluator, never this cross-validation routine.

    python -m ml.eval.ranker_eval --out ml/results/ranker_train.json
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from ml.eval.baseline_current_rag import ROOT
from ml.eval.metrics import METRICS, metrics
from ml.eval.live_rag_eval import CANDIDATES, fill, load_questions
from ml.eval.stats import document_bootstrap
from ml.ranking.features import FEATURES, group_features, label, vector
from ml.ranking.ranker import PARAMS, save, train

METHODS = ("fused", "cross_encoder", "pointwise", "lambdarank")
BASELINE = "cross_encoder"


def candidate_group(question, items):
    rows = group_features(question["question"], items)
    return {"qid": question["qid"], "file": question["file"], "answer_pages": question["answer_pages"],
            "pages": [item["page"] for item in items],
            "labels": [label(item, question["answer_pages"], question["answer_quote"]) for item in items],
            "features": [vector(row) for row in rows]}


def build_groups(questions):
    import retriever
    from reranker import get_cross_encoder
    from schemas import QueryScope
    groups = []
    for q in questions:
        items = retriever.retrieve(q["question"], CANDIDATES, QueryScope(docIds=[q["file"]]), "hybrid_concepts")
        logits = get_cross_encoder().predict([[q["question"], item["text"]] for item in items]) if items else []
        for item, logit in zip(items, logits):
            item["cross_encoder"] = float(logit)
        groups.append(candidate_group(q, items))
    return groups


def ordered(group, scores):
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    return [{"page": group["pages"][i]} for i in order]


def cross_validate(groups, seed=None):
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    ce, fused = FEATURES.index("cross_encoder"), FEATURES.index("fused_rank_inverse")
    results, gains = [], np.zeros(len(FEATURES))
    for held_out in sorted({g["file"] for g in groups}):
        fold = [g for g in groups if g["file"] != held_out and g["features"]]
        x = np.array([row for g in fold for row in g["features"]])
        y = np.array([value for g in fold for value in g["labels"]])
        ranker = train(fold) if seed is None else train(fold, seed=seed)
        gains += ranker.booster_.feature_importance("gain")
        pointwise = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=2000)).fit(x, y > 0)
        for g in (g for g in groups if g["file"] == held_out):
            features = np.array(g["features"]) if g["features"] else np.zeros((0, len(FEATURES)))
            scores = {"fused": features[:, fused] if len(features) else [],
                      "cross_encoder": features[:, ce] if len(features) else [],
                      "pointwise": pointwise.predict_proba(features)[:, 1] if len(features) else [],
                      "lambdarank": ranker.predict(features) if len(features) else []}
            row = {"file": g["file"], "qid": g["qid"]}
            for method, values in scores.items():
                row[method] = metrics(ordered(g, list(values)), g["answer_pages"])
            results.append(row)
    importance = sorted(zip(FEATURES, gains / gains.sum()), key=lambda pair: -pair[1])
    return results, [(name, round(float(share), 3)) for name, share in importance[:10]]


def summarise(results):
    report = {}
    for method in METHODS:
        report[method] = {}
        for metric in METRICS:
            by_file = defaultdict(list)
            for row in results:
                by_file[row["file"]].append(row[method][metric])
            report[method][metric] = document_bootstrap(by_file)
    report["paired_vs_" + BASELINE] = {}
    for method in (m for m in METHODS if m != BASELINE):
        report["paired_vs_" + BASELINE][method] = {}
        for metric in METRICS:
            by_file = defaultdict(list)
            for row in results:
                by_file[row["file"]].append(row[method][metric] - row[BASELINE][metric])
            report["paired_vs_" + BASELINE][method][metric] = document_bootstrap(by_file)
    return report


def validate_cached_groups(groups, questions):
    """Reject a cache from different questions/splits before fitting models."""
    expected = {q["qid"]: q for q in questions}
    if len(groups) != len(expected) or {g["qid"] for g in groups} != set(expected):
        raise ValueError("Candidate cache does not match the selected training questions")
    for group in groups:
        question = expected[group["qid"]]
        if group["file"] != question["file"] or group["answer_pages"] != question["answer_pages"]:
            raise ValueError("Candidate cache has different documents or gold pages")
        size = len(group["pages"])
        if (len(group["features"]) != size or len(group["labels"]) != size or
                any(len(row) != len(FEATURES) for row in group["features"])):
            raise ValueError("Candidate cache has incompatible feature rows")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--questions", type=Path, default=ROOT / "ml/eval/questions.jsonl")
    parser.add_argument("--pdf-dir", type=Path, default=ROOT / "Test PDFs")
    parser.add_argument("--bundles", type=Path, default=ROOT / "ml/out/bundles")
    parser.add_argument("--groups", type=Path, default=ROOT / "ml/out/ranker_groups.json", help="candidate cache")
    parser.add_argument("--require-cache", action="store_true", help="fail rather than rebuild candidates/load encoders")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--frozen-test-milestone", action="store_true", help="also score the test split")
    parser.add_argument("--save", type=Path, help="train on all scored questions and save the ranker here")
    args = parser.parse_args()
    if args.frozen_test_milestone:
        raise SystemExit("Frozen tests require the ML5 inference-only evaluator; this command fits models")
    if args.require_cache and not args.groups.is_file():
        raise SystemExit("--require-cache needs an existing candidate cache; no models were loaded")
    questions, splits = load_questions(args)
    if not questions:
        raise SystemExit("No answerable training questions")
    if args.groups.exists() and not args.frozen_test_milestone:
        groups = json.loads(args.groups.read_text(encoding="utf-8"))
        validate_cached_groups(groups, questions)
    else:
        from embedder import get_embeddings
        fill(sorted({q["file"] for q in questions}), args.pdf_dir, args.bundles, get_embeddings)
        groups = build_groups(questions)
        if not args.frozen_test_milestone:
            args.groups.parent.mkdir(parents=True, exist_ok=True)
            args.groups.write_text(json.dumps(groups), encoding="utf-8")
    results, importance = cross_validate(groups)
    report = {"questions": len(results), "documents": len({r["file"] for r in results}), "splits": sorted(splits),
              "candidates": CANDIDATES, "ranker": PARAMS, "features": list(FEATURES),
              "candidate_recall": round(sum(any(g["labels"]) for g in groups) / len(groups), 3),
              "metrics": summarise(results), "top_features_by_gain": importance}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{len(results)} questions; answer page among candidates: {report['candidate_recall']}")
    show = lambda values: "   ".join(f"{m} {v['value']:+.3f} [{v['ci95'][0]:+.3f}, {v['ci95'][1]:+.3f}]"
                                     for m, v in values.items())
    for method in METHODS:
        print(f"{method:14} {show(report['metrics'][method])}")
    for method, values in report["metrics"]["paired_vs_" + BASELINE].items():
        print(f"{method + ' - ' + BASELINE:28} {show(values)}")
    print("top features:", importance)
    if args.save:
        save(train(groups), args.save, questions=len(groups), splits=sorted(splits))
        print(f"saved {args.save}")


if __name__ == "__main__":
    main()
