"""ML2.10 cue/context features and the two feature models on toy data."""

import pytest

from ml.eval.label_scheme import COARSE_LABELS, coarse_rows
from ml.models.definition_features import (attach_context, cue_features, fit_cue_logistic,
                                           fit_stacked_lightgbm, hand_features, inner_text_probabilities)


def test_cues_fire_on_their_roles():
    assert cue_features("A graph is called bipartite if ...")["cue_def_is_called"] == 1
    assert cue_features("We say that f is continuous.")["cue_def_we_say"] == 1
    assert cue_features("Hence the claim holds by Lemma 2. ∎")["cue_prf_end"] == 1
    assert cue_features("Hence the claim holds by Lemma 2. ∎")["cue_prf_by_result"] == 1
    assert cue_features("Find the largest path.")["cue_ex_imperative"] == 1
    assert cue_features("Smith et al. (2020) showed")["cue_oth_citation"] == 1
    plain = cue_features("A plain sentence.")
    assert not any(value for name, value in plain.items() if name.startswith("cue_"))


def test_context_is_previous_heading_in_reading_order():
    blocks = [{"block_id": "c", "file": "f", "page": 2, "block_index": 0, "weak_label": None},
              {"block_id": "a", "file": "f", "page": 1, "block_index": 0, "weak_label": None},
              {"block_id": "b", "file": "f", "page": 1, "block_index": 1, "weak_label": "theorem"},
              {"block_id": "z", "file": "g", "page": 1, "block_index": 0, "weak_label": "proof"}]
    rows = attach_context([{"block_id": key} for key in "abcz"], blocks)
    assert [row["context"] for row in rows] == ["none", "none", "theorem", "none"]
    with pytest.raises(ValueError):
        attach_context([{"block_id": "missing"}], blocks)


def toy(n_groups=6):
    texts = {"definition": "We say a set is called {w} if it is defined so.",
             "theorem": "Let {w} be finite. Then there exists a bound for all n.",
             "proof": "Hence by Lemma {w} it follows, thus the claim. ∎",
             "example": "Find how many {w} there are? Compute it."}
    rows = []
    for g in range(n_groups):
        for label, template in texts.items():
            for k in range(3):
                rows.append({"block_id": f"{g}{label}{k}", "group": f"g{g}", "label": label,
                             "text": template.format(w=f"word{g}{k}"), "category": "paper",
                             "context": "theorem" if label == "proof" else "none",
                             "features": {"bold_ratio": 0.0, "font_size_rel": 1.0, "indent_rel": 0.0,
                                          "math_char_ratio": 0.1, "gap_above_rel": 1.0}})
    return rows


def test_hand_features_need_context():
    row = dict(toy()[0]); del row["context"]
    with pytest.raises(ValueError):
        hand_features(row)


@pytest.mark.parametrize("fit", [fit_cue_logistic, fit_stacked_lightgbm])
def test_models_learn_separable_toy_roles(fit):
    rows = toy()
    train = [row for row in rows if row["group"] != "g0"]
    held = [row for row in rows if row["group"] == "g0"]
    model = fit(train, [row["label"] for row in train])
    predicted = model.predict(held)
    assert sum(p == row["label"] for p, row in zip(predicted, held)) / len(held) >= 0.9


def test_inner_probabilities_never_use_own_source():
    rows = toy(4)
    labels = [row["label"] for row in rows]
    classes = sorted(set(labels))
    probabilities = inner_text_probabilities(rows, labels, classes, folds=4)
    assert probabilities.shape == (len(rows), 4)
    assert probabilities.sum(axis=1) == pytest.approx([1] * len(rows))


def test_cue_logistic_exposes_hand_weights():
    rows = toy()
    model = fit_cue_logistic(rows, [row["label"] for row in rows])
    weights = {(label, name): w for label, name, w in model.coefficients()}
    assert weights[("definition", "cue_def_we_say")] > 0


def test_coarse_scheme_maps_roles():
    rows = coarse_rows([{"label": label} for label in ("notation", "proof", "theorem", "algorithm")])
    assert [row["label"] for row in rows] == ["definition", "other", "theorem", "other"]
    assert COARSE_LABELS == ("definition", "theorem", "other")


@pytest.mark.parametrize("fit", [fit_cue_logistic, fit_stacked_lightgbm])
def test_models_accept_source_weights(fit):
    rows = toy()
    labels = [row["label"] for row in rows]
    model = fit(rows, labels, sample_weight=[1.0] * len(rows))
    assert len(model.predict(rows[:4])) == 4
    with pytest.raises(ValueError):
        fit(rows, labels, sample_weight=[0.0] * len(rows))
