"""Source-isolation, fold fitting and hand-checked classification metrics."""

import pytest

from ml.eval.classifier_cv import classification_metrics, cross_validate, summarise_predictions


def data():
    rows = [{"block_id":f"b{i}","group":f"g{i}","file":f"f{i}","fold":i,
             "text":f"unique{i} mathematical statement", "label":"proof" if i%2 else "definition"} for i in range(5)]
    split = {"status":"frozen","train_groups":[r["group"] for r in rows],"test_groups":["held"],"excluded_groups":[]}
    return rows,split,{r["file"]:{"group":r["group"]} for r in rows}


def test_confusion_matrix_and_macro_denominator():
    scores = classification_metrics(["proof","proof","definition"],["proof","definition","definition"])
    assert scores["accuracy"] == 2/3
    assert scores["per_class"]["proof"]["precision"] == 1
    assert scores["per_class"]["proof"]["recall"] == .5
    assert scores["macro_f1"] == pytest.approx((2/3+2/3)/7)


def test_each_fold_fits_only_other_sources_and_predicts_every_row_once():
    rows,split,manifest = data()
    calls = []
    def fit(texts, labels):
        calls.append(texts)
        class Model:
            def predict(self, dev):
                assert not set(texts) & set(dev)
                return ["proof"]*len(dev)
        return Model()
    predictions,folds = cross_validate(rows,split,manifest,fit)
    assert len(calls)==5 and all(len(call)==4 for call in calls)
    assert {r["block_id"] for r in predictions} == {r["block_id"] for r in rows}
    assert all(fold["missing_dev_classes"] for fold in folds)


@pytest.mark.parametrize("fault", ["heldout", "cross-fold", "duplicate", "missing-fold"])
def test_bad_source_partition_rejected(fault):
    rows,split,manifest = data()
    if fault == "heldout": split["train_groups"].remove("g0")
    elif fault == "cross-fold":
        rows[1]["group"] = "g0"; manifest["f1"]["group"] = "g0"
    elif fault == "duplicate": rows[1]["block_id"] = "b0"
    else: rows.pop()
    with pytest.raises(ValueError): cross_validate(rows,split,manifest)


def test_bootstrap_cluster_report_reproducible_and_perfect_bounds():
    predictions = [{"file":"a","gold":"proof","majority":"proof","logistic":"proof"},
                   {"file":"b","gold":"definition","majority":"proof","logistic":"definition"}]
    report = summarise_predictions(predictions,100)
    assert report == summarise_predictions(predictions,100)
    assert report["logistic"]["ci95"]["accuracy"] == [1,1]
    assert report["majority"]["ci95"]["accuracy"] == [0,1]


def test_empty_bootstrap_input_rejected():
    with pytest.raises(ValueError):
        summarise_predictions([])
