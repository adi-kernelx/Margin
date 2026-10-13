"""Two fixed development candidates; no grid search or held-out tuning."""

from ml.models.first_classifier import _fit_tfidf


def fit_balanced_classifier(texts, labels, sample_weight=None):
    """Change only class weighting relative to the original logistic baseline."""
    from sklearn.linear_model import LogisticRegression
    return _fit_tfidf(texts, labels, LogisticRegression(
        C=1.0, class_weight="balanced", max_iter=1000, random_state=20261006), sample_weight=sample_weight)


def fit_word_char_classifier(texts, labels, sample_weight=None):
    """Combine word semantics and within-word fragments; fit both on train only."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import FeatureUnion
    representation = FeatureUnion([
        ("word", TfidfVectorizer(ngram_range=(1, 2), min_df=1)),
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=2)),
    ])
    return _fit_tfidf(texts, labels, LogisticRegression(
        C=1.0, class_weight="balanced", max_iter=1000, random_state=20261006), representation, sample_weight=sample_weight)
