"""Active ML2.2 baseline and classifier acceptance tests."""

import pytest

from ml.models import first_classifier as exercise


def test_majority_and_deterministic_ties():
    assert exercise.majority_label(["proof", "theorem", "proof"]) == "proof"
    assert exercise.majority_label(["theorem", "definition"]) == "definition"
    assert exercise.majority_label(["definition", "theorem"]) == "definition"


def test_majority_rejects_empty_or_unknown_labels():
    for labels in ([], ["not-a-class"], [None]):
        with pytest.raises(ValueError):
            exercise.majority_label(labels)


def test_heading_abstains_without_fabricating_other():
    assert exercise.heading_prediction(None) is None
    assert exercise.heading_prediction("other") == "other"
    assert exercise.heading_prediction("definition") == "definition"
    with pytest.raises(ValueError):
        exercise.heading_prediction("not-a-class")


def training():
    return ["a set is closed by definition", "a function is convex by definition",
            "the conclusion follows by contradiction", "the argument follows by induction"], ["definition", "definition", "proof", "proof"]


def test_pipeline_predicts_valid_labels():
    texts, labels = training()
    model = exercise.fit_tfidf_classifier(texts, labels)
    assert set(model.named_steps) == {"tfidf", "classifier"}
    predictions = model.predict(texts)
    assert len(predictions) == len(texts) and set(predictions) <= set(labels)
    assert list(predictions) == labels


def test_prediction_never_fits_held_out_vocabulary():
    texts, labels = training()
    model = exercise.fit_tfidf_classifier(texts, labels)
    before = dict(model.named_steps["tfidf"].vocabulary_)
    model.predict(["heldoutuniquetoken"])
    assert model.named_steps["tfidf"].vocabulary_ == before
    assert "heldoutuniquetoken" not in before


def test_pipeline_rejects_bad_training_inputs():
    for texts, labels in (([], []), (["some text"], []), ([""], ["definition"]),
                          (["some text", "more text"], ["definition", "definition"]),
                          (["some text", "more text"], ["definition", "unknown"])):
        with pytest.raises(ValueError):
            exercise.fit_tfidf_classifier(texts, labels)


@pytest.mark.parametrize("labels", [None, "proof", ["proof", []]])
def test_invalid_label_containers_raise_value_error(labels):
    with pytest.raises(ValueError):
        exercise.majority_label(labels)


def test_pipeline_does_not_reuse_previous_vocabulary():
    texts, labels = training()
    first = exercise.fit_tfidf_classifier(texts, labels)
    second = exercise.fit_tfidf_classifier(["alpha alpha", "beta beta"], ["definition", "proof"])
    assert "alpha" not in first.named_steps["tfidf"].vocabulary_
    assert "induction" not in second.named_steps["tfidf"].vocabulary_
