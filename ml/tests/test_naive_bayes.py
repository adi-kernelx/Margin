"""Fair model comparison, independent vocabularies and NB failure cases."""

import pytest

from ml.models.first_classifier import fit_tfidf_naive_bayes
from ml.eval.classifier_cv import cross_validate, summarise_predictions
from ml.tests.test_classifier_cv import data


def test_nb_learns_and_prediction_preserves_vocabulary():
    model = fit_tfidf_naive_bayes(["definition meaning concept", "proof argument induction"], ["definition", "proof"])
    assert list(model.predict(["meaning concept", "argument induction"])) == ["definition", "proof"]
    before = dict(model.named_steps["tfidf"].vocabulary_)
    model.predict(["heldoutonlyword"])
    assert model.named_steps["tfidf"].vocabulary_ == before
    assert model.named_steps["classifier"].alpha == 1.0


@pytest.mark.parametrize("texts,labels", [([],[]),(["a meaningful sentence"],[]),([""],["proof"]),
                                         (["text one","text two"],["proof","proof"]),
                                         (["text one","text two"],["proof","invalid"])])
def test_bad_nb_inputs_rejected(texts,labels):
    with pytest.raises(ValueError): fit_tfidf_naive_bayes(texts,labels)


def test_both_fitters_receive_identical_train_and_dev_rows():
    rows,split,manifest = data()
    seen = {"logistic":[],"naive_bayes":[]}
    def factory(method):
        def fit(texts,labels):
            seen[method].append((list(texts),list(labels)))
            class Model:
                def predict(self,dev):
                    assert not set(texts) & set(dev)
                    return ["proof"]*len(dev)
            return Model()
        return fit
    predictions,_ = cross_validate(rows,split,manifest,fitters={method:factory(method) for method in seen})
    assert seen["logistic"] == seen["naive_bayes"] and len(seen["logistic"]) == 5
    report = summarise_predictions(predictions,100)
    assert report["logistic"] == report["naive_bayes"]


def test_nb_fits_do_not_share_vocabulary():
    first = fit_tfidf_naive_bayes(["alpha concept","beta proof"],["definition","proof"])
    second = fit_tfidf_naive_bayes(["gamma concept","delta proof"],["definition","proof"])
    assert "gamma" not in first.named_steps["tfidf"].vocabulary_
    assert "alpha" not in second.named_steps["tfidf"].vocabulary_
