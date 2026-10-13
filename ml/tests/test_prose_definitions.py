"""ML2.14 emphasis, sentence splitting, LaTeX positives and the sentence detector (toy data)."""

import pytest

from ml.data.emphasis import emphasised_terms
from ml.data.latex_definitions import align, latex_sentences, prose_outside_environments
from ml.models.prose_definitions import block_sentences, fit_sentence_detector, sentence_features
from ml.models.sentences import split_sentences


def span(text, font="CMR10", flags=0):
    return {"text": text, "font": font, "flags": flags}


def test_emphasis_is_text_style_change_not_maths():
    spans = [span("A graph is called "), span("bipartite", "CMTI10", 2), span(" if its vertex set "),
             span("G", "CMMI10", 2), span(" splits.")]
    assert emphasised_terms(spans) == ["bipartite"]


def test_upright_word_inside_italic_theorem_counts_and_heading_is_ignored():
    spans = [span("Definition 2.1.", "CMBX10", 16), span("A space is ", "CMTI10", 2), span("compact"),
             span(" if every cover has a finite subcover.", "CMTI10", 2)]
    assert emphasised_terms(spans, heading_text="Definition 2.1.") == ["compact"]


def test_sentence_split_keeps_abbreviations_and_numbers():
    text = "We say a set is open, e.g. the interval. See Fig. 2 for details. By Lemma 2.1. the claim holds. Done."
    assert split_sentences(text) == ["We say a set is open, e.g. the interval.", "See Fig. 2 for details.",
                                     "By Lemma 2.1. the claim holds.", "Done."]


def test_latex_sentences_need_emphasis_and_cue_outside_environments():
    tex = (r"\newtheorem{thm}{Theorem}" "\n\n"
           r"A graph is called \emph{bipartite} if its vertices split into two classes." "\n\n"
           r"\begin{thm}A tree is called \emph{rooted} if one vertex is marked as the root.\end{thm}" "\n\n"
           r"We study \emph{many} graphs in this section of the paper today." "\n\n")
    assert "rooted" not in prose_outside_environments(tex)
    sentences = latex_sentences(tex)
    assert len(sentences) == 1 and "bipartite" in sentences[0]


def test_latex_alignment_is_unique_or_dropped():
    words = ["graph", "called", "bipartite", "its", "vertices", "split", "into", "two", "classes"]
    blocks = [{"block_id": "b1", "group": "g", "weak_label": None,
               "text": "Background. A graph is called bipartite if its vertices split into two classes."},
              {"block_id": "b2", "group": "g", "weak_label": None, "text": "Something else entirely here."}]
    decisions, counts = align([words], blocks)
    assert decisions == [{"block_id": "b1", "group": "g", "sentence_index": 1}] and counts["aligned"] == 1
    _, counts = align([words], blocks + [dict(blocks[0], block_id="b3")])
    assert counts["ambiguous"] == 1


def test_sentence_features_cues_emphasis_and_gloss():
    f = sentence_features("A graph is called bipartite if it splits.", ["bipartite"], 0, "paper")
    assert f["cue_called"] == 1 and f["emphasis"] == 1 and f["emphasis_and_cue"] == 1
    g = sentence_features("Round-Trip Time (RTT) (definition): time for a packet to return", [], 0, "slides")
    assert g["cue_gloss"] == 1
    h = sentence_features("Hence the bound holds by Lemma 2.", [], 1, "paper")
    assert h["proof_opening"] == 1 and h["cue_called"] == 0


def test_detector_scores_blocks_by_best_sentence():
    positives = [f"A structure is called type{i} if it satisfies property {i}." for i in range(12)]
    negatives = [f"Hence the bound {i} follows from the previous lemma directly." for i in range(12)]
    sentences = positives + negatives
    features = [sentence_features(s, [], 0, "paper") for s in sentences]
    detector = fit_sentence_detector(sentences, features, [1] * 12 + [0] * 12)
    block = {"text": "Hence the bound follows. A structure is called special if it holds.", "category": "paper"}
    assert detector.block_score(block, []) > detector.block_score({"text": "Hence it follows.", "category": "paper"}, [])
    assert len(block_sentences(block, [])) == 2
    with pytest.raises(ValueError):
        fit_sentence_detector(sentences, features, [1] * 24)
