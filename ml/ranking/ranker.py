"""ML4: train, save, load and apply the LambdaRank re-ranker."""

import numpy as np

from ml.ranking.features import FEATURES, group_features, vector

# Fixed before the first run; not tuned.
PARAMS = dict(objective="lambdarank", n_estimators=150, learning_rate=0.05, num_leaves=7, min_child_samples=10,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, label_gain=[0, 1, 3],
              lambdarank_truncation_level=10, random_state=0, verbose=-1)


def validate_features(features):
    features = tuple(features)
    if not features or features != tuple(name for name in FEATURES if name in features):
        raise ValueError("Ranker requires an ordered subset of the known features")
    return features


def train(groups, seed=None, features=FEATURES):
    import lightgbm as lgb
    groups = [g for g in groups if g["features"]]
    x = np.array([row for g in groups for row in g["features"]])
    y = np.array([value for g in groups for value in g["labels"]])
    params = dict(PARAMS)
    if seed is not None:
        params["random_state"] = seed
    features = validate_features(features)
    indices = [FEATURES.index(name) for name in features]
    model = lgb.LGBMRanker(**params).fit(x[:, indices], y, group=[len(g["features"]) for g in groups])
    model.margin_features_ = features
    return model


def save(model, path, **meta):
    import joblib
    import lightgbm as lgb
    path.parent.mkdir(parents=True, exist_ok=True)
    features = validate_features(getattr(model, "margin_features_", FEATURES))
    joblib.dump({**meta, "model": model, "features": list(features), "lightgbm": lgb.__version__}, path)


def load(path):
    import joblib
    bundle = joblib.load(path)
    features = validate_features(bundle["features"])
    model = bundle["model"]
    if getattr(model, "n_features_in_", None) != len(features):
        raise ValueError("Ranker feature list does not match the model")
    model.margin_features_ = features
    return model


def score(model, question, items):
    """Ranker scores for candidates carrying retriever signals and a cross_encoder logit."""
    if not items:
        return []
    features = getattr(model, "margin_features_", FEATURES)
    return np.asarray(model.predict(np.array([vector(row, features) for row in group_features(question, items)]))).tolist()
