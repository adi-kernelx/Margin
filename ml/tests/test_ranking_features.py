import pytest

from ml.ranking.features import FEATURES, group_features, label, vector


def item(**fields):
    base = {"text": "a graph is bipartite if its vertices split", "page": 2, "kind": "passage", "score": 0.03,
            "fused_rank": 1, "bm25": 4.0, "bm25_rank": 1, "cosine": 0.6, "dense_rank": 2, "cross_encoder": 3.0, "last_page": 10}
    return {**base, **fields}


def test_labels_grade_page_and_quote():
    quote = "its vertices split"
    assert label(item(), [2], quote) == 2
    assert label(item(text="vertices   split its"), [2], quote) == 2  # most quote words present
    assert label(item(text="unrelated words"), [2], quote) == 1
    assert label(item(page=3), [2], quote) == 0


def test_group_features_are_relative_within_a_question():
    items = [item(), item(bm25=2.0, bm25_rank=2, cosine=0.4, cross_encoder=-1.0, fused_rank=2),
             item(kind="concept", type="Theorem", title="Bipartite graph", verified=True, bm25=0.0, bm25_rank=51,
                  fused_rank=3, cross_encoder=1.0)]
    rows = group_features("What is a bipartite graph?", items)
    assert [r["cross_encoder_rank_inverse"] for r in rows] == [1.0, pytest.approx(1 / 3), 0.5]
    assert rows[1]["bm25_relative"] == 0.5 and rows[1]["cosine_gap"] == pytest.approx(-0.2)
    assert rows[2]["concept_result"] == 1.0 and rows[2]["verified"] == 1.0
    assert rows[2]["title_in_question"] == 1.0 and rows[0]["title_in_question"] == 0.0
    assert rows[0]["question_what"] == 1.0 and rows[0]["page_position"] == 0.2
    assert len(vector(rows[0])) == len(FEATURES)


def test_empty_group():
    assert group_features("q", []) == []


def test_ranker_round_trip(tmp_path):
    pytest.importorskip("lightgbm")
    from ml.ranking.ranker import load, save, score, train
    rows = group_features("what is bipartite", [item(page=p, bm25=float(p)) for p in range(1, 7)])
    groups = [{"features": [vector(r) for r in rows], "labels": [0, 0, 0, 0, 1, 2]} for _ in range(30)]
    path = tmp_path / "ranker.joblib"
    save(train(groups), path)
    model = load(path)
    scores = score(model, "what is bipartite", [item(page=p, bm25=float(p)) for p in range(1, 7)])
    assert len(scores) == 6 and scores[5] > scores[0]
    assert score(model, "q", []) == []


def test_ranker_rejects_other_features(tmp_path):
    joblib = pytest.importorskip("joblib")
    from ml.ranking.ranker import load
    path = tmp_path / "old.joblib"
    joblib.dump({"model": None, "features": ["bm25"]}, path)
    with pytest.raises(ValueError):
        load(path)
