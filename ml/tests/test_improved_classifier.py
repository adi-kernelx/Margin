"""Fixed-candidate settings, input validation and train-only vocabularies."""
import pytest
from ml.models.improved_classifier import fit_balanced_classifier, fit_word_char_classifier
from ml.eval.classifier_cv import summarise_predictions


@pytest.mark.parametrize("fitter", [fit_balanced_classifier, fit_word_char_classifier])
def test_candidates_learn_and_do_not_refit_vocabulary(fitter):
    texts = ["meaning concept defined", "meaning concept term", "argument induction proof", "argument induction result"]
    model = fitter(texts, ["definition", "definition", "proof", "proof"])
    assert list(model.predict(["meaning concept", "argument induction"])) == ["definition", "proof"]
    assert model.named_steps["classifier"].class_weight == "balanced"
    representation = model.named_steps["tfidf"]
    vectors = [v for _, v in representation.transformer_list] if hasattr(representation, "transformer_list") else [representation]
    before = [dict(v.vocabulary_) for v in vectors]
    model.predict(["xyzunseentoken"])
    assert before == [v.vocabulary_ for v in vectors]


@pytest.mark.parametrize("fitter", [fit_balanced_classifier, fit_word_char_classifier])
@pytest.mark.parametrize("texts,labels", [([], []), (["text"], ["proof"]), (["", "valid"], ["proof", "definition"])])
def test_candidate_invalid_inputs(fitter, texts, labels):
    with pytest.raises(ValueError): fitter(texts, labels)


def test_summary_includes_both_candidates_with_identical_bootstrap_draws():
    rows = [{"file": str(i), "gold": "proof", "majority": "proof", "logistic": "proof",
             "balanced_logistic": "proof", "word_char_logistic": "proof"} for i in range(2)]
    scores = summarise_predictions(rows, 20)
    assert scores["balanced_logistic"] == scores["word_char_logistic"] == scores["logistic"]
