"""ML2.5: layout-only boosted trees, fitted independently per source fold."""

import math
from numbers import Real

from ml.models.first_classifier import _validated_labels

FEATURES = ("bold_ratio", "font_size_rel", "indent_rel", "math_char_ratio", "gap_above_rel")
PARAMETERS = {"objective": "multiclass", "metric": "None", "learning_rate": 0.05,
              "num_leaves": 15, "min_data_in_leaf": 10, "num_threads": 2,
              "seed": 20261006, "deterministic": True, "force_col_wise": True,
              "verbosity": -1}
ROUNDS = 100


def layout_features(rows):
    """Allowlist five finite measurements and category; ignore every other field."""
    if isinstance(rows, (str, bytes)):
        raise ValueError("Rows must be a sequence of block mappings")
    try:
        rows = list(rows)
    except TypeError as error:
        raise ValueError("Rows must be iterable") from error
    if not rows:
        raise ValueError("Need nonempty layout rows")
    result = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("features"), dict):
            raise ValueError("Missing layout feature mapping")
        category = row.get("category")
        if not isinstance(category, str) or not category.strip():
            raise ValueError("Need a nonempty document category")
        values = {"category": category}
        for name in FEATURES:
            value = row["features"].get(name)
            if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value):
                raise ValueError(f"Layout feature {name} must be finite numeric data")
            values[name] = float(value)
        result.append(values)
    return result


class LayoutClassifier:
    def __init__(self, vectorizer, booster, classes):
        self.vectorizer, self.booster, self.classes = vectorizer, booster, classes

    def predict(self, rows):
        values = self.vectorizer.transform(layout_features(rows))
        probabilities = self.booster.predict(values)
        return [self.classes[index] for index in probabilities.argmax(axis=1)]


def fit_layout_classifier(rows, labels):
    values = layout_features(rows)
    labels = _validated_labels(labels)
    if len(values) != len(labels) or len(set(labels)) < 2:
        raise ValueError("Need matching layout/label sequences and at least two classes")
    from sklearn.feature_extraction import DictVectorizer
    import lightgbm as lgb

    vectorizer = DictVectorizer(sparse=False)
    matrix = vectorizer.fit_transform(values)
    classes = sorted(set(labels))
    encoded = [classes.index(label) for label in labels]
    dataset = lgb.Dataset(matrix, label=encoded)
    booster = lgb.train({**PARAMETERS, "num_class": len(classes)}, dataset, num_boost_round=ROUNDS)
    return LayoutClassifier(vectorizer, booster, classes)
