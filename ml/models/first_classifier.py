"""ML2.2 baselines and heading-free TF-IDF/logistic regression.

Fit only the training portion of each grouped CV run. No evaluation or model
persistence is performed here. See README.md for the mechanism and limitations.
"""

from collections import Counter
import math
from numbers import Real

from ml.data.make_splits import LABELS


def _validated_labels(labels):
    if isinstance(labels, (str, bytes)):
        raise ValueError("Labels must be a sequence, not a string")
    try:
        values = list(labels)
    except TypeError as error:
        raise ValueError("Labels must be iterable") from error
    if not values or any(not isinstance(label, str) or label not in LABELS for label in values):
        raise ValueError("Need nonempty labels from the seven known classes")
    return values


def validated_weights(weights, count):
    if weights is None:
        return None
    try:
        values = list(weights)
    except TypeError as error:
        raise ValueError("Weights must be iterable") from error
    if len(values) != count or any(isinstance(w, bool) or not isinstance(w, Real) or not math.isfinite(w) or w <= 0 for w in values):
        raise ValueError("Need matching positive finite sample weights")
    return values


def majority_label(labels, sample_weight=None):
    """Return the most frequent training label; alphabetical tie-break.

    Reject empty inputs and values outside the seven labels in heading_rules.
    Fit this on a CV training fold, never development or held-out labels.
    """
    values = _validated_labels(labels)
    weights = validated_weights(sample_weight, len(values))
    counts = Counter()
    for label, weight in zip(values, weights if weights is not None else [1] * len(values)):
        counts[label] += weight
    return min(counts, key=lambda label: (-counts[label], label))


def heading_prediction(weak_label):
    """Return the original weak label, or None for an unlabelled block.

    This baseline abstains on prose without headings; do not map None to other.
    Reject an unknown label. Never use headings as learned-model text features.
    """
    if weak_label is None:
        return None
    return _validated_labels([weak_label])[0]


def fit_tfidf_classifier(texts, labels, seed=20261006, sample_weight=None):
    """Fit and return a sklearn Pipeline with named steps tfidf and classifier.

    Use heading-free training texts, TfidfVectorizer and LogisticRegression.
    Reject empty/mismatched inputs, empty texts and fewer than two classes.
    The fitted pipeline supports predict(list[str]); transform dev without fit.
    Fixed starter settings are documented in README.md.
    """
    from sklearn.linear_model import LogisticRegression
    return _fit_tfidf(texts, labels, LogisticRegression(C=1.0, max_iter=1000, random_state=seed), sample_weight=sample_weight)


def fit_tfidf_naive_bayes(texts, labels, sample_weight=None):
    """Same nonnegative TF-IDF representation, fixed Laplace smoothing alpha=1."""
    from sklearn.naive_bayes import MultinomialNB
    return _fit_tfidf(texts, labels, MultinomialNB(alpha=1.0), sample_weight=sample_weight)


def _fit_tfidf(texts, labels, classifier, vectorizer=None, sample_weight=None):
    values = _validated_labels(labels)
    if isinstance(texts, (str, bytes)):
        raise ValueError("Texts must be a sequence, not a string")
    try:
        documents = list(texts)
    except TypeError as error:
        raise ValueError("Texts must be iterable") from error
    if len(documents) != len(values) or any(not isinstance(text, str) or not text.strip() for text in documents):
        raise ValueError("Need matching nonempty text/label sequences")
    if len(set(values)) < 2:
        raise ValueError("Classifier comparison requires at least two classes")

    # Imports are lazy: the counting/heading baselines do not need sklearn.
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.pipeline import Pipeline

    model = Pipeline([
        ("tfidf", vectorizer if vectorizer is not None else TfidfVectorizer(ngram_range=(1, 2), min_df=1)),
        ("classifier", classifier),
    ])
    weights = validated_weights(sample_weight, len(values))
    model.fit(documents, values, **({"classifier__sample_weight": weights} if weights is not None else {}))
    return model
