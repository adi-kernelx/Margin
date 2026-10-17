"""ML4: train, save, load and apply the LambdaRank re-ranker."""

import numpy as np

from ml.ranking.features import FEATURES, group_features, vector

# Fixed before the first run; not tuned.
PARAMS = dict(objective="lambdarank", n_estimators=150, learning_rate=0.05, num_leaves=7, min_child_samples=10,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, label_gain=[0, 1, 3],
              lambdarank_truncation_level=10, random_state=0, verbose=-1)


def train(groups, seed=None):
    import lightgbm as lgb
    groups = [g for g in groups if g["features"]]
    x = np.array([row for g in groups for row in g["features"]])
    y = np.array([value for g in groups for value in g["labels"]])
    params = dict(PARAMS)
    if seed is not None:
        params["random_state"] = seed
    return lgb.LGBMRanker(**params).fit(x, y, group=[len(g["features"]) for g in groups])


def save(model, path, **meta):
    import joblib
    import lightgbm as lgb
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": list(FEATURES), "lightgbm": lgb.__version__, **meta}, path)


def load(path):
    import joblib
    bundle = joblib.load(path)
    if bundle["features"] != list(FEATURES):
        raise ValueError("Ranker was trained with a different feature list")
    return bundle["model"]


def score(model, question, items):
    """Ranker scores for candidates carrying retriever signals and a cross_encoder logit."""
    if not items:
        return []
    return np.asarray(model.predict(np.array([vector(row) for row in group_features(question, items)]))).tolist()
