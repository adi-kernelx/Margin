"""Fixed ML5 variants, feature ablations and freeze integrity checks."""

import hashlib
import json
from pathlib import Path

from ml.eval.baseline_current_rag import ROOT
from ml.ranking.features import FEATURES
from ml.ranking.ranker import PARAMS

SEEDS = (0, 1, 2)
BASELINE = "cross_encoder"
PRIMARY = "ranker_full"
ML4_MODEL_SHA256 = "7e35f36de053c0b970658c769f789bb40fdc423da879256d38890380b5c5571f"
RETRIEVAL = {"off": "hybrid_concepts", "on": "hybrid_concepts_links", "passages": "hybrid"}
FEATURE_GROUPS = {
    "ce": ("cross_encoder", "cross_encoder_gap", "cross_encoder_rank_inverse"),
    "lexical": ("bm25", "bm25_relative", "bm25_rank_inverse", "question_coverage"),
    "dense": ("cosine", "cosine_gap", "dense_rank_inverse"),
    "concept": ("is_concept", "concept_definition", "concept_notation", "concept_algorithm", "concept_result",
                "verified", "title_in_question"),
    "context": ("log_length", "page_position", "question_what", "question_why", "question_how", "question_which",
                "question_when", "question_length"),
    "fusion": ("rrf", "fused_rank_inverse"),
}
VARIANTS = {
    "fused": {"pool": "off", "kind": "fused"},
    "fused_passages": {"pool": "passages", "kind": "fused"},
    "fused_links": {"pool": "on", "kind": "fused"},
    BASELINE: {"pool": "off", "kind": "ce"},
    "ce_passages": {"pool": "passages", "kind": "ce"},
    "ce_links": {"pool": "on", "kind": "ce"},
    PRIMARY: {"pool": "off", "kind": "ranker", "features": list(FEATURES)},
    "ranker_passages": {"pool": "passages", "kind": "ranker", "features": list(FEATURES)},
    "ranker_links": {"pool": "on", "kind": "ranker", "features": list(FEATURES)},
    **{"without_" + group: {"pool": "off", "kind": "ranker", "features": [f for f in FEATURES if f not in removed]}
       for group, removed in FEATURE_GROUPS.items()},
}
SOURCES = ("ml/eval/ml5_protocol.py", "ml/eval/ml5_train.py", "ml/eval/milestone_eval.py", "ml/eval/ml5_report.py",
           "ml/eval/ml5_scoring.py",
           "ml/eval/metrics.py", "ml/eval/stats.py", "ml/eval/live_rag_eval.py", "ml/eval/ranker_eval.py",
           "ml/eval/link_expansion_eval.py", "ml/ranking/features.py", "ml/ranking/ranker.py",
           "ml/retrieval/hybrid.py", "ml/retrieval/links.py", "ml/eval/validate_questions.py",
           "local-llm/rag-api/retriever.py", "local-llm/rag-api/concepts_api.py", "local-llm/rag-api/store.py",
           "local-llm/rag-api/embedder.py", "local-llm/rag-api/reranker.py",
           "local-llm/rag-api/prompt.py", "local-llm/rag-api/llm_client.py",
           "Test PDFs/manifest.csv", "ml/splits.json")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_hashes():
    return {path: sha256(ROOT / path) for path in SOURCES}


def check_protocol(protocol):
    if (protocol.get("version") != 1 or protocol.get("status") != "frozen" or
            protocol.get("variants") != VARIANTS or protocol.get("seeds") != list(SEEDS) or
            protocol.get("features") != list(FEATURES) or protocol.get("sources") != source_hashes() or
            protocol.get("params") != PARAMS or protocol.get("primary") != PRIMARY or
            protocol.get("baseline") != BASELINE):
        raise ValueError("Protocol/configuration/source mismatch; freeze on TRAIN before any test read")
    learned = {name for name, spec in VARIANTS.items() if spec["kind"] == "ranker"}
    if set(protocol.get("models", {})) != learned:
        raise ValueError("Protocol must include every declared learned variant")
    if protocol["models"].get(PRIMARY, {}).get("0", {}).get("sha256") != ML4_MODEL_SHA256:
        raise ValueError("Primary model must retain the frozen ML4 seed-0 artifact")
    for name, models in protocol["models"].items():
        if set(models) != {str(seed) for seed in SEEDS}:
            raise ValueError("Protocol must freeze all three seeds")
        for entry in models.values():
            if entry["features"] != VARIANTS[name]["features"] or sha256(ROOT / entry["path"]) != entry["sha256"]:
                raise ValueError("Frozen model artifact mismatch")
    return protocol


def load_protocol(path):
    return check_protocol(json.loads(Path(path).read_text(encoding="utf-8")))
