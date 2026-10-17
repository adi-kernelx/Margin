"""Score saved models or fixed retrieval signals; no fitting code."""

import numpy as np

from ml.eval.metrics import metrics
from ml.ranking.features import FEATURES


def rank_group(group, spec, model=None):
    x = np.asarray(group["features"], dtype=float)
    if not len(x):
        return []
    if spec["kind"] == "ranker":
        indices = [FEATURES.index(name) for name in spec["features"]]
        scores = model.predict(x[:, indices])
    else:
        feature = "cross_encoder" if spec["kind"] == "ce" else "fused_rank_inverse"
        scores = x[:, FEATURES.index(feature)]
    return sorted(range(len(scores)), key=lambda i: -scores[i])


def predict_group(group, spec, model=None):
    order = rank_group(group, spec, model)
    return metrics([{"page": group["pages"][i]} for i in order], group["answer_pages"])
