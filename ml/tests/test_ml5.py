"""ML5 guardrails and statistics use synthetic data only."""

import copy
import json
from types import SimpleNamespace

import numpy as np
import pytest

from ml.eval import milestone_eval, ml5_protocol, ml5_report, ml5_train
from ml.eval.metrics import METRICS
from ml.eval.ml5_protocol import FEATURE_GROUPS, PRIMARY, SEEDS, VARIANTS
from ml.ranking.features import FEATURES


def outcome(qid, file, dataset="original", baseline=0.5, full=0.6):
    return {"qid": qid, "file": file, "set": dataset, "type": "definition",
            **{name: dict.fromkeys(METRICS, full if name == PRIMARY else baseline) for name in VARIANTS}}


def test_feature_groups_partition_the_existing_schema_and_remove_all_ce_signals():
    flattened = [name for names in FEATURE_GROUPS.values() for name in names]
    assert len(flattened) == len(set(flattened)) == len(FEATURES)
    assert set(flattened) == set(FEATURES)
    assert not any("cross_encoder" in f for f in VARIANTS["without_ce"]["features"])
    assert SEEDS == (0, 1, 2)


def test_exact_mcnemar_discordant_counts_and_fractional_recall_guard():
    assert ml5_report.mcnemar([0] * 6, [1] * 6)["p_two_sided"] == 0.03125
    assert ml5_report.mcnemar([1, 0], [0, 1])["p_two_sided"] == 1.0
    assert ml5_report.mcnemar([1], [1])["discordant"] == 0
    assert ml5_report.mcnemar([0.5], [1])["p_two_sided"] is None
    with pytest.raises(ValueError):
        ml5_report.mcnemar([1], [])


def test_pooled_bootstrap_keeps_both_sets_same_pdf_in_one_cluster():
    rows = [outcome("original:q", "a", baseline=0, full=1),
            outcome("independent:q", "a", "independent", baseline=1, full=0),
            outcome("original:other", "b", baseline=1, full=1)]
    output = ml5_report.report(rows, {"original": {}, "independent": {}})
    assert output["pooled"]["documents"] == 2 and output["pooled"]["questions"] == 3
    assert output["pooled"]["paired"][PRIMARY]["mrr_at_10"]["ci95"] == [0, 0]
    assert output["sets"]["independent"]["questions"] == 1
    assert output["breakdowns"]["other"]["questions"] == 0


def test_switch_rule_needs_both_sets_and_all_pre_registered_conditions():
    rows = [outcome("original:q", "a"), outcome("independent:q", "b", "independent")]
    output = ml5_report.report(rows, {"original": {}, "independent": {}})
    assert ml5_report.decision(output)["switch_default"]
    output["sets"]["independent"]["paired"][PRIMARY]["ndcg_at_10"]["value"] = -0.001
    assert not ml5_report.decision(output)["switch_default"]
    output["sets"].pop("independent")
    assert not ml5_report.decision(output)["switch_default"]


def test_training_cli_rejects_milestone_before_question_read(monkeypatch):
    monkeypatch.setattr("sys.argv", ["ml5_train", "--out", "unused.json", "--frozen-test-milestone"])
    monkeypatch.setattr(ml5_train, "load_questions", lambda *args: pytest.fail("No question read allowed"))
    with pytest.raises(SystemExit, match="fits models on TRAIN"):
        ml5_train.main()


def test_milestone_cli_requires_explicit_mode_before_protocol_read(monkeypatch):
    monkeypatch.setattr("sys.argv", ["milestone_eval", "--protocol", "unused.json"])
    monkeypatch.setattr(milestone_eval, "load_protocol", lambda *args: pytest.fail("Must reject before read"))
    with pytest.raises(SystemExit):
        milestone_eval.main()


def test_preflight_never_opens_questions_or_claims_receipt(monkeypatch, tmp_path):
    monkeypatch.setattr("sys.argv", ["milestone_eval", "--protocol", "unused.json", "--preflight"])
    monkeypatch.setattr(milestone_eval, "load_protocol", lambda *args: {})
    monkeypatch.setattr(milestone_eval, "load_test_sets", lambda: pytest.fail("No frozen read"))
    monkeypatch.setattr(milestone_eval, "RECEIPT", tmp_path / "receipt.json")
    milestone_eval.main()
    assert not milestone_eval.RECEIPT.exists()


def test_receipt_is_claimed_before_read_and_failure_blocks_a_second_read(monkeypatch, tmp_path):
    receipt = tmp_path / "receipt.json"
    monkeypatch.setattr(milestone_eval, "RECEIPT", receipt)
    monkeypatch.setattr(milestone_eval, "load_models", lambda protocol: {})
    reads = []

    def fail_after_claim():
        assert json.loads(receipt.read_text())["status"] == "started"
        reads.append(True)
        raise ValueError("synthetic data error")

    monkeypatch.setattr(milestone_eval, "load_test_sets", fail_after_claim)
    with pytest.raises(ValueError, match="synthetic"):
        milestone_eval.run({}, "hash", tmp_path / "report.json")
    assert json.loads(receipt.read_text())["status"] == "failed"
    with pytest.raises(RuntimeError, match="already claimed"):
        milestone_eval.run({}, "hash", tmp_path / "report.json")
    assert reads == [True]


def test_protocol_rejects_changed_artifacts_and_configuration(tmp_path, monkeypatch):
    artifact = tmp_path / "model.joblib"
    artifact.write_bytes(b"synthetic bytes")
    monkeypatch.setattr(ml5_protocol, "ROOT", tmp_path)
    monkeypatch.setattr(ml5_protocol, "ML4_MODEL_SHA256", ml5_protocol.sha256(artifact))
    monkeypatch.setattr(ml5_protocol, "source_hashes", lambda: {"source": "frozen"})
    models = {name: {str(seed): {"path": artifact.name, "sha256": ml5_protocol.sha256(artifact),
                               "features": spec["features"]} for seed in SEEDS}
              for name, spec in VARIANTS.items() if spec["kind"] == "ranker"}
    protocol = {"version": 1, "status": "frozen", "variants": copy.deepcopy(VARIANTS), "seeds": list(SEEDS),
                "features": list(FEATURES), "sources": {"source": "frozen"}, "models": models,
                "params": ml5_protocol.PARAMS, "primary": PRIMARY, "baseline": ml5_protocol.BASELINE}
    assert ml5_protocol.check_protocol(protocol) is protocol
    wrong = copy.deepcopy(protocol)
    wrong["seeds"] = [2]
    with pytest.raises(ValueError, match="configuration"):
        ml5_protocol.check_protocol(wrong)
    artifact.write_bytes(b"changed")
    with pytest.raises(ValueError, match="artifact"):
        ml5_protocol.check_protocol(protocol)


def candidate(value):
    return {"text": f"text {value}", "kind": "passage", "page": value, "score": 0.03,
            "bm25": 1.0, "bm25_rank": value, "cosine": 0.5, "dense_rank": value,
            "fused_rank": value, "last_page": 2, "verified": True}


def test_milestone_inference_predicts_subsets_and_never_fits(monkeypatch):
    import retriever
    import reranker
    import ml.ranking.ranker

    calls = []

    class Model:
        def __init__(self, size):
            self.size = size

        def predict(self, x):
            assert x.shape[1] == self.size
            calls.append(x.shape)
            return np.arange(len(x))

    models = {name: {str(seed): Model(len(spec["features"])) for seed in SEEDS}
              for name, spec in VARIANTS.items() if spec["kind"] == "ranker"}
    monkeypatch.setattr(retriever, "retrieve", lambda *args: [candidate(1), candidate(2)])
    monkeypatch.setattr(reranker, "get_cross_encoder", lambda: SimpleNamespace(predict=lambda pairs: [0.0, 1.0]))
    monkeypatch.setattr(ml.ranking.ranker, "train", lambda *args, **kwargs: pytest.fail("No fitting at inference"))
    question = {"qid": "original:q", "file": "toy.pdf", "question": "what is x", "answer_pages": [2],
                "type": "definition", "set": "original"}
    question.update(answerable=True, answer_quote="toy evidence")
    grading = []
    output = milestone_eval.infer([question], models, grading, {question["qid"]})
    assert set(output) == {"0", "1", "2"}
    assert output["0"][0][PRIMARY]["mrr_at_10"] == 1.0
    assert len(calls) == 27
    assert len(grading) == 1 and set(grading[0]["contexts"]) == {ml5_protocol.BASELINE, PRIMARY}
    assert grading[0]["answer_quote"] == "toy evidence"


def test_train_cross_validation_keeps_documents_separate_for_each_ablation(monkeypatch):
    fitted = []

    class Model:
        def predict(self, x):
            return np.arange(len(x))

    def train(groups, seed, features):
        fitted.append(({g["file"] for g in groups}, seed, features))
        return Model()

    monkeypatch.setattr(ml5_train, "train", train)
    questions = [{"qid": file, "file": file, "type": "definition"} for file in ("a", "b")]
    groups = [{"qid": file, "file": file, "features": [[0.0] * len(FEATURES)], "labels": [1],
               "pages": [1], "answer_pages": [1]} for file in ("a", "b")]
    rows = ml5_train.cross_validate(dict.fromkeys(("off", "on", "passages"), groups), questions, seed=2)
    assert len(fitted) == 18 and all(seed == 2 for _, seed, _ in fitted)
    assert all(files == {"b"} for files, _, _ in fitted[:9])
    assert all(files == {"a"} for files, _, _ in fitted[9:])
    assert len(rows) == 2 and set(VARIANTS) <= rows[0].keys()


def test_frozen_loader_reads_each_synthetic_set_once_and_namespaces_ids(tmp_path, monkeypatch):
    import pymupdf
    (tmp_path / "Test PDFs").mkdir()
    (tmp_path / "ml").mkdir()
    (tmp_path / "Test PDFs/manifest.csv").write_text(
        "file,group,use\ntoy.pdf,test-source,main\ntrain.pdf,train-source,main\n", encoding="utf-8")
    (tmp_path / "ml/splits.json").write_text(json.dumps({"status": "frozen", "train_groups": ["train-source"],
        "test_groups": ["test-source"], "excluded_groups": []}), encoding="utf-8")
    test = {"qid": "same-id", "file": "toy.pdf", "group": "test-source", "question": "toy question",
            "answer_pages": [1], "answer_quote": "Evidence", "type": "definition", "answerable": True}
    original, independent = tmp_path / "original.jsonl", tmp_path / "independent.jsonl"
    # The intentionally incomplete TRAIN row must be routed away before evidence validation.
    original.write_text(json.dumps({"file": "train.pdf"}) + "\n" + json.dumps(test), encoding="utf-8")
    independent.write_text(json.dumps(test), encoding="utf-8")
    monkeypatch.setattr(milestone_eval, "ROOT", tmp_path)
    monkeypatch.setattr(milestone_eval, "TEST_SETS", {"original": (original, 1), "independent": (independent, 1)})
    opened = []

    class Document:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def __iter__(self):
            return iter([SimpleNamespace(get_text=lambda: "Evidence")])

    def open_pdf(path):
        opened.append(path.name)
        return Document()

    monkeypatch.setattr(pymupdf, "open", open_pdf)
    reads = []
    from pathlib import Path
    read_bytes = Path.read_bytes

    def track(path):
        reads.append(path)
        return read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", track)
    sets, counts, hashes = milestone_eval.load_test_sets()
    assert reads == [original, independent] and opened == ["toy.pdf"]
    assert sets["original"][0]["qid"] == "original:same-id"
    assert sets["independent"][0]["qid"] == "independent:same-id"
    assert counts["original"] == {"total": 1, "answerable": 1, "unanswerable": 0}
    assert set(hashes) == {"original", "independent"}


def test_successful_receipt_is_complete_and_cannot_be_replayed(tmp_path, monkeypatch):
    import embedder
    monkeypatch.setattr(milestone_eval, "RECEIPT", tmp_path / "receipt.json")
    monkeypatch.setattr(milestone_eval, "load_models", lambda protocol: {})
    question = {"file": "toy.pdf"}
    monkeypatch.setattr(milestone_eval, "load_test_sets", lambda: (
        {"original": [question], "independent": [question]}, {"original": {}, "independent": {}}, {"toy": "hash"}))
    monkeypatch.setattr(milestone_eval, "select_grading", lambda sets: set())
    monkeypatch.setattr(embedder, "get_embeddings", lambda *args: pytest.fail("No real embedding"))
    monkeypatch.setattr(milestone_eval, "fill", lambda *args: None)
    rows = [outcome("original:q", "a"), outcome("independent:q", "b", "independent")]
    monkeypatch.setattr(milestone_eval, "infer", lambda *args: {str(seed): rows for seed in SEEDS})
    out = tmp_path / "report.json"
    result = milestone_eval.run({}, "protocol-hash", out)
    state = json.loads(milestone_eval.RECEIPT.read_text())
    assert state["status"] == "complete" and state["output_sha256"] == milestone_eval.sha256(out)
    assert result["dataset_sha256"] == {"toy": "hash"}
    with pytest.raises(RuntimeError, match="already claimed"):
        milestone_eval.run({}, "protocol-hash", tmp_path / "another.json")


def test_grading_selection_is_fixed_balanced_and_deterministic():
    sets = {name: [{"qid": f"{name}:answer-{i}", "answerable": True} for i in range(25)] +
                  [{"qid": f"{name}:no-answer-{i}", "answerable": False} for i in range(7)]
            for name in ("original", "independent")}
    chosen = milestone_eval.select_grading(sets)
    assert len(chosen) == 50 and chosen == milestone_eval.select_grading(sets)
    for name, rows in sets.items():
        assert sum(q["answerable"] and q["qid"] in chosen for q in rows) == 20
        assert sum(not q["answerable"] and q["qid"] in chosen for q in rows) == 5
