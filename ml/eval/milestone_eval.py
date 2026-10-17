"""Inference-only ML5 milestone. Do not run on real frozen sets during ML5.1.

--preflight checks the frozen protocol/artifacts without opening question sets.
--frozen-test-milestone claims a permanent receipt before the one test read.
"""

import argparse
import csv
import hashlib
import json
import random
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from ml.eval.baseline_current_rag import ROOT
from ml.eval.live_rag_eval import CANDIDATES, fill
from ml.eval.metrics import metrics
from ml.eval.ml5_protocol import BASELINE, PRIMARY, RETRIEVAL, SEEDS, VARIANTS, load_protocol, sha256
from ml.eval.ml5_report import decision, report
from ml.eval.ml5_scoring import rank_group
from ml.eval.validate_questions import group_splits, validate_lines
from ml.ranking.features import group_features, vector
from ml.ranking.ranker import load

RECEIPT = ROOT / "ml/models/artifacts/ml5/frozen_test_receipt.json"
TEST_SETS = {"original": (ROOT / "ml/eval/questions.jsonl", 80),
             "independent": (ROOT / "ml/eval/questions_independent.jsonl", 78)}


def load_test_sets():
    import pymupdf
    with (ROOT / "Test PDFs/manifest.csv").open(encoding="utf-8") as source:
        manifest = {row["file"]: row for row in csv.DictReader(source)}
    splits = group_splits(json.loads((ROOT / "ml/splits.json").read_text(encoding="utf-8")))

    @lru_cache(maxsize=None)
    def page_texts(file):
        root = (ROOT / "Test PDFs").resolve()
        path = (root / file).resolve()
        if path.parent != root:
            raise ValueError("PDF path escapes the dataset directory")
        with pymupdf.open(path) as document:
            return [page.get_text() for page in document]

    sets, counts, hashes = {}, {}, {}
    for name, (path, expected_count) in TEST_SETS.items():
        raw = path.read_bytes()  # one filesystem read, also used for the audit hash
        hashes[name] = hashlib.sha256(raw).hexdigest()
        selected = []
        for line in raw.decode("utf-8-sig").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            entry = manifest.get(row.get("file"))
            if entry is None:
                raise ValueError("Unknown source in frozen question collection")
            split = splits.get(entry["group"])
            if name == "original" and split == "train":
                continue
            if split != "test":
                raise ValueError("Frozen collection contains a non-test source")
            selected.append(line)
        rows, errors = validate_lines(selected, manifest, splits, page_texts)
        if errors or len(rows) != expected_count:
            raise ValueError(f"Frozen {name} schema/evidence/count check failed; receipt remains consumed")
        counts[name] = {"total": len(rows), "answerable": sum(q["answerable"] for q in rows),
                        "unanswerable": sum(not q["answerable"] for q in rows)}
        sets[name] = [dict(q, qid=f"{name}:{q['qid']}", set=name) for q in rows]
    return sets, counts, hashes


def select_grading(sets):
    """Predeclared 20 answerable + 5 unanswerable questions from each set."""
    rng = random.Random(20261017)
    selected = set()
    for name in ("original", "independent"):
        for answerable, count in ((True, 20), (False, 5)):
            pool = sorted((q["qid"] for q in sets[name] if q["answerable"] == answerable))
            if len(pool) < count:
                raise ValueError("Insufficient questions for the predeclared grading sample")
            selected.update(rng.sample(pool, count))
    return selected


def load_models(protocol):
    models = {}
    for name, entries in protocol["models"].items():
        models[name] = {}
        for seed, entry in entries.items():
            model = load(ROOT / entry["path"])
            if list(model.margin_features_) != VARIANTS[name]["features"]:
                raise ValueError("Saved model feature order does not match the protocol")
            models[name][seed] = model
    return models


def infer(questions, models, grading=None, selected=()):
    import retriever
    from reranker import get_cross_encoder
    from schemas import QueryScope

    runs = {str(seed): [] for seed in SEEDS}
    for question in questions:
        contexts = {}
        pools = {pool: retriever.retrieve(question["question"], CANDIDATES,
            QueryScope(docIds=[question["file"]]), method) for pool, method in RETRIEVAL.items()}
        texts = list(dict.fromkeys(item["text"] for items in pools.values() for item in items))
        logits = get_cross_encoder().predict([[question["question"], text] for text in texts]) if texts else []
        if len(logits) != len(texts):
            raise ValueError("Cross-encoder logit count mismatch")
        scores = dict(zip(texts, map(float, logits)))
        groups = {}
        for pool, items in pools.items():
            for item in items:
                item["cross_encoder"] = scores[item["text"]]
            groups[pool] = {"features": [vector(row) for row in group_features(question["question"], items)],
                            "pages": [item["page"] for item in items], "answer_pages": question["answer_pages"]}
        for seed in SEEDS:
            row = {key: question[key] for key in ("qid", "file", "type", "set")}
            for name, spec in VARIANTS.items():
                model = models[name][str(seed)] if spec["kind"] == "ranker" else None
                group = groups[spec["pool"]]
                order = rank_group(group, spec, model)
                row[name] = metrics([{"page": group["pages"][i]} for i in order], group["answer_pages"])
                if seed == 0 and question["qid"] in selected and name in (BASELINE, PRIMARY):
                    contexts[name] = [pools[spec["pool"]][i] for i in order[:8]]
            if question.get("answerable", True):
                runs[str(seed)].append(row)
        if grading is not None and question["qid"] in selected:
            grading.append({"qid": question["qid"], "set": question["set"], "question": question["question"],
                            "answerable": question["answerable"], "answer_pages": question["answer_pages"],
                            "answer_quote": question["answer_quote"], "contexts": contexts})
    return runs


def claim_receipt(path, protocol_hash):
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {"status": "started", "started_at": datetime.now(timezone.utc).isoformat(),
             "protocol_sha256": protocol_hash}
    try:
        with path.open("x", encoding="utf-8") as target:
            json.dump(state, target, indent=2)
    except FileExistsError:
        raise RuntimeError("Frozen milestone already claimed; do not repeat the test read") from None
    return state


def run(protocol, protocol_hash, out):
    if out.exists():
        raise ValueError("Result file already exists")
    if RECEIPT.exists():
        raise RuntimeError("Frozen milestone already claimed; do not repeat the test read")
    models = load_models(protocol)  # validate loadability before consuming the receipt
    state = claim_receipt(RECEIPT, protocol_hash)
    try:
        sets, counts, hashes = load_test_sets()
        questions = [q for rows in sets.values() for q in rows]
        selected = select_grading(sets)
        from embedder import get_embeddings
        fill(sorted({q["file"] for q in questions}), ROOT / "Test PDFs", ROOT / "ml/out/bundles", get_embeddings)
        grading = []
        runs = infer(questions, models, grading, selected)
        if len(grading) != len(selected) or any(set(row["contexts"]) != {BASELINE, PRIMARY} for row in grading):
            raise ValueError("Grading inputs are incomplete; preserve the receipt and diagnose without a repeat read")
        output = report(runs["0"], counts)  # fixed seed-0 primary model, never best-seed selection
        output["per_seed"] = {seed: report(rows, counts) for seed, rows in runs.items()}
        output["decision"] = decision(output)
        output["protocol_sha256"] = protocol_hash
        output["dataset_sha256"] = hashes
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
        # Metrics-only audit supports later analysis without another model/test read.
        audit = RECEIPT.parent / "frozen_outcomes.json"
        audit.write_text(json.dumps(runs), encoding="utf-8")
        grading_path = RECEIPT.parent / "grading_inputs.json"
        grading_path.write_text(json.dumps(grading), encoding="utf-8")
        state.update(status="complete", dataset_sha256=hashes, output_sha256=sha256(out), audit_sha256=sha256(audit),
                     grading_sha256=sha256(grading_path))
    except BaseException as error:
        state.update(status="failed", error_type=type(error).__name__)
        raise
    finally:
        state["finished_at"] = datetime.now(timezone.utc).isoformat()
        RECEIPT.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight", action="store_true")
    mode.add_argument("--frozen-test-milestone", action="store_true")
    args = parser.parse_args()
    if args.frozen_test_milestone and args.out is None:
        parser.error("--out is required for the milestone")
    protocol = load_protocol(args.protocol)
    if args.preflight:
        print("Protocol, source and artifact hashes match. No frozen question set was opened.")
        return
    run(protocol, sha256(args.protocol), args.out)


if __name__ == "__main__":
    main()
