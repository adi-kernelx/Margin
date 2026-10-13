"""ML2.14: sentence-level prose-definition detector.

A block is scored by its most definition-like sentence. Each sentence gets
TF-IDF words plus explainable features:

  * defining cues in the sentence ("is called", "we say", "is defined as", ":=");
  * whether an emphasised term from the PDF (ml/data/emphasis.py) occurs in the
    sentence, and whether emphasis and a cue occur together;
  * discourse openings typical of proofs ("Hence", "Thus", "Since", "By");
  * sentence length, first-sentence position and document category.

Training sentences (built per development fold, so held-out sources never enter):
  positives - LaTeX-marked prose definitions aligned to PDF sentences
              (ml/data/latex_definitions.py), plus cue- or emphasis-bearing
              sentences of headed definition/notation blocks;
  negatives - sentences of reliable-negative unheaded blocks (ML2.14 variant C)
              and of headed theorem/proof/example/algorithm blocks.
"""

import math
import re

from ml.models.sentences import split_sentences

SENTENCE_CUES = {
    "called": r"\b(?:is|are|be) (?:called|termed|known as|referred to as)\b|\bso-called\b",
    "we_say": r"\bwe (?:say|call)\b",
    "said_to_be": r"\b(?:is|are) said to be\b",
    "defined_as": r"\b(?:is|are) defined (?:as|by|to be)\b|\bdefined as\b",
    "we_define": r"\b(?:we|let us) define\b|\bdefine (?:a|an|the)\b",
    "denote": r"\bdenote[sd]? (?:by|as)\b|\bis denoted\b|\bstands? for\b",
    "assign": r":=|≜|≡",
    "iff": r"\bif and only if\b|\biff\b",
    "if_then_call": r"^\s*(?:if|when)\b.*\b(?:called|we say|is said)\b",
    # Slide/bullet gloss, "Round-Trip Time (RTT) (definition): time for ...".
    # Added after reading development errors (ML2.14), so dev scores are optimistic.
    "gloss": r"^\s*[A-Z][\w\-’' ]{1,40}(?:\([^)]{1,20}\)\s*)*\s*:\s+\S|\(definition\)",
}
_CUES = {name: re.compile(pattern, re.I) for name, pattern in SENTENCE_CUES.items()}
_PROOF_OPENING = re.compile(r"^\s*(?:hence|thus|therefore|since|by|then|so|moreover|it follows|this implies|note that)\b", re.I)
_SUBJECT_OPENING = re.compile(r"^\s*(?:a|an|the|for|given|let|if|when|we)\b", re.I)


def emphasis_in(sentence, terms):
    lowered = sentence.lower()
    return any(len(term) >= 3 and term.lower() in lowered for term in terms)


def sentence_features(sentence, terms, position, category):
    values = {f"cue_{name}": float(bool(pattern.search(sentence))) for name, pattern in _CUES.items()}
    any_cue = any(values.values())
    emphasised = emphasis_in(sentence, terms)
    values.update({
        "emphasis": float(emphasised),
        "emphasis_and_cue": float(emphasised and any_cue),
        "proof_opening": float(bool(_PROOF_OPENING.match(sentence))),
        "subject_opening": float(bool(_SUBJECT_OPENING.match(sentence))),
        "first_sentence": float(position == 0),
        "log_words": math.log1p(len(sentence.split())),
        "category": category,
    })
    return values


def block_sentences(block, terms):
    """(sentence, features) pairs for one block's heading-free text."""
    text = (block.get("text_without_heading") or block["text"]).strip()
    return [(s, sentence_features(s, terms, i, block["category"])) for i, s in enumerate(split_sentences(text))]


class SentenceDetector:
    def __init__(self, words, hand, model):
        self.words, self.hand, self.model = words, hand, model

    def _matrix(self, sentences, features):
        from scipy.sparse import csr_matrix, hstack
        return hstack([self.words.transform(sentences), csr_matrix(self.hand.transform(features))]).tocsr()

    def sentence_scores(self, sentences, features):
        if not sentences:
            return []
        column = list(self.model.classes_).index(1)
        return list(self.model.predict_proba(self._matrix(sentences, features))[:, column])

    def block_score(self, block, terms):
        pairs = block_sentences(block, terms)
        scores = self.sentence_scores([s for s, _ in pairs], [f for _, f in pairs])
        return max(scores) if scores else 0.0

    def hand_weights(self):
        names = list(self.hand[0].get_feature_names_out())
        offset = len(self.words.vocabulary_)
        return {name: float(self.model.coef_[0][offset + j]) for j, name in enumerate(names)}


def fit_sentence_detector(sentences, features, labels, sample_weight=None, seed=20261013):
    """Balanced logistic regression on sentence TF-IDF plus scaled hand features."""
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    if not sentences or len(sentences) != len(features) or len(features) != len(labels) or len(set(labels)) != 2:
        raise ValueError("Need matching sentences, features and binary labels with both classes")
    words = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True).fit(sentences)
    hand = make_pipeline(DictVectorizer(sparse=False), StandardScaler()).fit(features)
    detector = SentenceDetector(words, hand, None)
    detector.model = LogisticRegression(C=1.0, class_weight="balanced", max_iter=2000, random_state=seed).fit(
        detector._matrix(sentences, features), labels, sample_weight=sample_weight)
    return detector
