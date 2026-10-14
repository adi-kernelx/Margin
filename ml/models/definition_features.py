"""ML2.10: cue-phrase, context and layout features, and two models that use them.

Three hand-designed feature groups sit beside the TF-IDF text model:

- cue phrases: wording that marks a role ("we say", "is called" for definitions;
  "Hence", "by Lemma" for proofs; "Find", "Compute" for exercises; citation
  patterns for references). Each cue is a regular expression with a name, so a
  learned weight can be read back and explained.
- context: the heading label of the previous block in reading order. A proof
  usually follows a theorem; this is the information 6 of the 50 audited ML2.6
  errors needed. Only the previous block's *heading* label is used, which the
  heading rule also produces at inference, never its gold or weak label from a
  learned source.
- layout: the five ML2.5 measurements plus document category.

Models:

- `fit_cue_logistic`: one balanced logistic regression over TF-IDF words plus
  the scaled cue/context/layout columns. A single linear model, so every
  feature weight is inspectable.
- `fit_stacked_lightgbm`: LightGBM over the text model's class probabilities
  plus the same hand features. The probabilities for training rows come from an
  inner source-grouped cross-fit, never from a text model that saw those rows.
"""

import math
import re
from collections import defaultdict

from ml.models.first_classifier import _validated_labels, validated_weights
from ml.models.layout_classifier import FEATURES as LAYOUT

CUES = {
    # definitions
    "def_we_say": r"\bwe (?:say|call)\b",
    "def_is_called": r"\b(?:is|are) (?:called|said to be|known as|referred to as|termed)\b",
    "def_define": r"\b(?:we )?defin(?:e|es|ed)\b",
    "def_denote": r"\b(?:denote[sd]?|stands? for|write)\b",
    "def_assign": r":=|≜|≡",
    "def_iff": r"\bif and only if\b|\biff\b",
    # theorem-like statements
    "thm_let_then": r"\b(?:let|suppose|assume)\b.*\bthen\b",
    "thm_there_exists": r"\bthere (?:exists?|is|are)\b",
    "thm_for_all": r"\bfor (?:all|every|each|any)\b",
    # proofs
    "prf_connective": r"\b(?:hence|thus|therefore|consequently|so that|it follows)\b",
    "prf_by_result": r"\bby (?:lemma|theorem|proposition|corollary|claim|induction|definition|assumption)\b",
    "prf_since": r"^\s*(?:since|because|first|now|conversely|finally)\b",
    "prf_end": r"(?:∎|□|■|\bqed\b)\s*$",
    "prf_contradiction": r"\bcontradict",
    # examples and exercises
    "ex_imperative": r"^\s*(?:\(?[a-z0-9]\)|\d+\s*\.)?\s*(?:find|compute|calculate|solve|show|prove|determine|consider|evaluate|explain|use)\b",
    "ex_question": r"\?",
    "ex_how_many": r"\bhow (?:many|much)\b",
    # algorithms
    "alg_io": r"\b(?:input|output|require|ensure|return)s?\b\s*:?",
    "alg_steps": r"(?:^|\s)\d+\s*:\s",
    "alg_loop": r"\b(?:for|while)\b.*\bdo\b|\bend (?:for|while|if)\b|←",
    # references and other text
    "oth_citation": r"\[\d+(?:\s*,\s*\d+)*\]|\bet al\.|\bdoi\b|https?://|\b(?:19|20)\d\d\)",
    "oth_figure": r"^\s*(?:figure|table|fig\.)\s*\d",
}
_COMPILED = {name: re.compile(pattern, re.I) for name, pattern in CUES.items()}
CONTEXT_LABELS = ("definition", "theorem", "proof", "example", "notation", "algorithm", "other", "none")


def cue_features(text):
    """Binary cue indicators plus two length measures for one heading-free text."""
    if not isinstance(text, str):
        raise ValueError("Cue features need text")
    values = {f"cue_{name}": float(bool(pattern.search(text))) for name, pattern in _COMPILED.items()}
    words = text.split()
    values["log_chars"] = math.log1p(len(text))
    values["sentences"] = float(len(re.findall(r"[.!?](?:\s|$)", text)))
    values["digit_ratio"] = sum(ch.isdigit() for ch in text) / max(len(text), 1)
    values["short"] = float(len(words) < 12)
    return values


def attach_context(rows, blocks):
    """Return row copies with `context` = heading label of the previous block.

    Reading order is (file, page, block_index). The first block of a file has
    context "none"; an unlabelled previous block also gives "none".
    """
    ordered = defaultdict(list)
    for block in blocks:
        ordered[block["file"]].append(block)
    previous = {}
    for file_blocks in ordered.values():
        file_blocks.sort(key=lambda block: (block["page"], block["block_index"]))
        for before, block in zip([None] + file_blocks[:-1], file_blocks):
            previous[block["block_id"]] = (before or {}).get("weak_label") or "none"
    missing = [row["block_id"] for row in rows if row["block_id"] not in previous]
    if missing:
        raise ValueError(f"{len(missing)} rows have no block in the context source")
    return [{**row, "context": previous[row["block_id"]]} for row in rows]


def hand_features(row):
    """Cue + context + layout features for one row (dict of name -> float/str)."""
    if row.get("context") not in CONTEXT_LABELS:
        raise ValueError("Row needs a context label; call attach_context first")
    values = cue_features(row["text"])
    values.update({f"prev_{label}": float(row["context"] == label) for label in CONTEXT_LABELS})
    for name in LAYOUT:
        value = row["features"][name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"Layout feature {name} must be finite")
        values[name] = float(value)
    values["category"] = row["category"]
    return values


def _hand_matrix_fitter():
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    # DictVectorizer one-hot encodes the string `category`; scaling puts cue
    # indicators and layout measurements on comparable ranges for the linear model.
    return make_pipeline(DictVectorizer(sparse=False), StandardScaler())


def _check(rows, labels):
    labels = _validated_labels(labels)
    rows = list(rows)
    if len(rows) != len(labels) or len(set(labels)) < 2:
        raise ValueError("Need matching rows/labels and at least two classes")
    return rows, labels


class CueLogistic:
    def __init__(self, words, hand, model):
        self.words, self.hand, self.model = words, hand, model

    def _matrix(self, rows):
        from scipy.sparse import csr_matrix, hstack
        return hstack([self.words.transform([r["text"] for r in rows]),
                       csr_matrix(self.hand.transform([hand_features(r) for r in rows]))]).tocsr()

    def predict(self, rows):
        return list(self.model.predict(self._matrix(rows)))

    def coefficients(self):
        """(class, feature name, weight) for the hand features, for inspection."""
        names = list(self.hand[0].get_feature_names_out())
        offset = len(self.words.vocabulary_)
        return [(label, name, float(self.model.coef_[i][offset + j]))
                for i, label in enumerate(self.model.classes_) for j, name in enumerate(names)]


def fit_cue_logistic(rows, labels, seed=20261006, sample_weight=None):
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    rows, labels = _check(rows, labels)
    weights = validated_weights(sample_weight, len(labels))
    words = TfidfVectorizer(ngram_range=(1, 2), min_df=1).fit([r["text"] for r in rows])
    hand = _hand_matrix_fitter().fit([hand_features(r) for r in rows])
    model = CueLogistic(words, hand, None)
    model.model = LogisticRegression(C=1.0, class_weight="balanced", max_iter=2000,
                                     random_state=seed).fit(model._matrix(rows), labels,
                                                                         sample_weight=weights)
    return model


STACK_PARAMETERS = {"objective": "multiclass", "metric": "None", "learning_rate": 0.05,
                    "num_leaves": 15, "min_data_in_leaf": 10, "num_threads": 2,
                    "seed": 20261006, "deterministic": True, "force_col_wise": True, "verbosity": -1}
STACK_ROUNDS = 150
INNER_FOLDS = 4


def _fit_text_model(train_rows, train_labels, weights=None):
    from ml.models.improved_classifier import fit_balanced_classifier
    return fit_balanced_classifier([r["text"] for r in train_rows], train_labels, sample_weight=weights)


def _aligned_probabilities(model, predict_rows, classes):
    """Text-model probabilities with columns aligned to `classes`."""
    import numpy as np
    raw = model.predict_proba([r["text"] for r in predict_rows])
    out = np.zeros((len(predict_rows), len(classes)))
    for j, label in enumerate(model.classes_):
        out[:, classes.index(label)] = raw[:, j]
    return out


def _text_probabilities(train_rows, train_labels, predict_rows, classes, weights=None):
    """Balanced TF-IDF logistic probabilities, columns aligned to `classes`."""
    return _aligned_probabilities(_fit_text_model(train_rows, train_labels, weights), predict_rows, classes)


def inner_text_probabilities(rows, labels, classes, folds=INNER_FOLDS, weights=None):
    """Out-of-fold text probabilities for training rows, grouped by source.

    Sources are dealt round-robin into folds (sorted by name, so deterministic).
    A source whose held-out complement has a single class falls back to uniform
    probabilities rather than a degenerate model.
    """
    import numpy as np
    groups = sorted({r["group"] for r in rows})
    fold_of = {group: i % folds for i, group in enumerate(groups)}
    out = np.full((len(rows), len(classes)), 1 / len(classes))
    for fold in range(min(folds, len(groups))):
        held = [i for i, r in enumerate(rows) if fold_of[r["group"]] == fold]
        kept = [i for i, r in enumerate(rows) if fold_of[r["group"]] != fold]
        if not held or len({labels[i] for i in kept}) < 2:
            continue
        out[held] = _text_probabilities([rows[i] for i in kept], [labels[i] for i in kept],
                                        [rows[i] for i in held], classes,
                                        None if weights is None else [weights[i] for i in kept])
    return out


class StackedLightGBM:
    def __init__(self, text_model, hand, booster, classes):
        # The text model is fitted once on all training rows; earlier versions
        # refitted the same deterministic model on every predict call.
        self.text_model, self.hand, self.booster, self.classes = text_model, hand, booster, classes

    def _matrix(self, text_probabilities, rows):
        import numpy as np
        return np.hstack([text_probabilities, self.hand.transform([hand_features(r) for r in rows])])

    def predict_proba(self, rows):
        """Class probabilities, columns in `self.classes` order."""
        rows = list(rows)
        probabilities = _aligned_probabilities(self.text_model, rows, self.classes)
        return self.booster.predict(self._matrix(probabilities, rows))

    def predict(self, rows):
        return [self.classes[i] for i in self.predict_proba(rows).argmax(axis=1)]


def fit_stacked_lightgbm(rows, labels, sample_weight=None):
    import lightgbm as lgb
    from sklearn.feature_extraction import DictVectorizer
    rows, labels = _check(rows, labels)
    weights = validated_weights(sample_weight, len(labels))
    classes = sorted(set(labels))
    hand = DictVectorizer(sparse=False).fit([hand_features(r) for r in rows])
    model = StackedLightGBM(_fit_text_model(rows, labels, weights), hand, None, classes)
    matrix = model._matrix(inner_text_probabilities(rows, labels, classes, weights=weights), rows)
    dataset = lgb.Dataset(matrix, label=[classes.index(label) for label in labels], weight=weights)
    model.booster = lgb.train({**STACK_PARAMETERS, "num_class": len(classes)}, dataset,
                              num_boost_round=STACK_ROUNDS)
    return model
