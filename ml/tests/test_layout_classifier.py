"""Layout allowlisting, category isolation and fair grouped evaluation."""

import copy
import pytest

from ml.models.layout_classifier import FEATURES, fit_layout_classifier, layout_features
from ml.eval.classifier_cv import cross_validate, summarise_predictions
from ml.tests.test_classifier_cv import data


def block(value, category="math"):
    return {"features": dict.fromkeys(FEATURES, value), "category": category,
            "text": "secret text", "file": "private.pdf", "label": "proof"}


def test_allowlist_excludes_text_identity_labels_and_extra_features():
    row = block(0.1)
    row["features"]["label"] = "proof"
    assert set(layout_features([row])[0]) == set(FEATURES) | {"category"}


@pytest.mark.parametrize("value", [None, True, "1", float("nan"), float("inf")])
def test_invalid_measurements_rejected(value):
    with pytest.raises(ValueError):
        layout_features([block(value)])


@pytest.mark.parametrize("rows", [[], "text", [{}], [{"features": {}, "category": ""}]])
def test_invalid_rows_rejected(rows):
    with pytest.raises(ValueError):
        layout_features(rows)


def test_model_learns_without_mutating_inputs_and_ignores_unseen_category():
    rows = [block(0.0) for _ in range(20)] + [block(1.0) for _ in range(20)]
    labels = ["definition"] * 20 + ["proof"] * 20
    before = copy.deepcopy(rows)
    model = fit_layout_classifier(rows, labels)
    assert model.predict([block(0.0), block(1.0)]) == ["definition", "proof"]
    vocabulary = dict(model.vectorizer.vocabulary_)
    model.predict([block(0.0, "heldout-only")])
    assert model.vectorizer.vocabulary_ == vocabulary
    assert rows == before
    assert fit_layout_classifier(rows, labels).predict(rows) == model.predict(rows)


@pytest.mark.parametrize("labels", [[], ["proof"], ["proof", "proof"], ["proof", "invalid"]])
def test_invalid_fit_labels_rejected(labels):
    with pytest.raises(ValueError):
        fit_layout_classifier([block(0.0), block(1.0)], labels)


def test_layout_and_text_models_use_same_source_folds():
    rows, split, manifest = data()
    seen = {"logistic": [], "layout_lightgbm": []}
    def text_fit(texts, labels):
        seen["logistic"].append(texts)
        class Model:
            def predict(self, dev): return ["proof"] * len(dev)
        return Model()
    def row_fit(train, labels):
        seen["layout_lightgbm"].append([row["text"] for row in train])
        class Model:
            def predict(self, dev):
                assert not {r["group"] for r in train} & {r["group"] for r in dev}
                return ["proof"] * len(dev)
        return Model()
    predictions, _ = cross_validate(rows, split, manifest, fitters={"logistic": text_fit},
                                     row_fitters={"layout_lightgbm": row_fit})
    assert seen["logistic"] == seen["layout_lightgbm"]
    report = summarise_predictions(predictions, 100)
    assert report["logistic"] == report["layout_lightgbm"]


def test_duplicate_method_names_rejected():
    rows, split, manifest = data()
    with pytest.raises(ValueError):
        cross_validate(rows, split, manifest, row_fitters={"logistic": lambda a, b: None})
