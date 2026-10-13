"""Tests for ml.data.heading_rules — heading detection and label mapping."""

import sys, os
# Ensure the repo root is on sys.path so `ml.data` is importable.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.data.heading_rules import (
    detect_heading, remove_heading_from_text, check_mid_block_heading,
    is_toc_entry,
)


# -----------------------------------------------------------------------
# POSITIVE cases — heading IS detected
# -----------------------------------------------------------------------

class TestPositiveHeadings:
    """Each of these should return a HeadingMatch with the expected label."""

    def test_definition_numbered_with_name(self):
        h = detect_heading("Definition 2.1 (Regular point). A point x* is ...",
                           is_bold=False)
        assert h is not None
        assert h.weak_label == "definition"
        assert h.weak_subtype == "definition"
        assert h.heading_number == "2.1"
        assert h.heading_name == "Regular point"
        assert "terminator" in h.heading_evidence

    def test_definition_no_number(self):
        h = detect_heading("Definition. Let f be convex ...")
        assert h is not None
        assert h.weak_label == "definition"
        assert "terminator" in h.heading_evidence

    def test_theorem_uppercase(self):
        h = detect_heading("THEOREM 1.25", is_uppercase=True)
        assert h is not None
        assert h.weak_label == "theorem"
        assert h.weak_subtype == "theorem"
        assert h.heading_number == "1.25"
        assert "uppercase" in h.heading_evidence

    def test_lemma_with_colon(self):
        h = detect_heading("Lemma 3: For all m, n >= 3 ...")
        assert h is not None
        assert h.weak_label == "theorem"
        assert h.weak_subtype == "lemma"
        assert h.heading_number == "3"
        assert "terminator" in h.heading_evidence

    def test_corollary(self):
        h = detect_heading("Corollary 4.2.")
        assert h is not None
        assert h.weak_label == "theorem"
        assert h.weak_subtype == "corollary"

    def test_claim(self):
        h = detect_heading("Claim 1.")
        assert h is not None
        assert h.weak_label == "theorem"
        assert h.weak_subtype == "claim"

    def test_proof_simple(self):
        h = detect_heading("Proof.")
        assert h is not None
        assert h.weak_label == "proof"
        assert h.weak_subtype == "proof"

    def test_proof_of_theorem(self):
        h = detect_heading("Proof of Theorem 2.1.")
        assert h is not None
        assert h.weak_label == "proof"
        assert h.weak_subtype == "proof"
        assert "terminator" in h.heading_evidence

    def test_example(self):
        h = detect_heading("Example 3.4", is_bold=True)
        assert h is not None
        assert h.weak_label == "example"
        assert h.weak_subtype == "example"

    def test_exercise(self):
        h = detect_heading("Exercise 1.12", is_bold=True)
        assert h is not None
        assert h.weak_label == "example"
        assert h.weak_subtype == "exercise"

    def test_algorithm_with_function(self):
        h = detect_heading("Algorithm 7 ML-KEM.KeyGen()")
        assert h is not None
        assert h.weak_label == "algorithm"
        assert h.weak_subtype == "algorithm"
        assert h.heading_number == "7"

    def test_remark(self):
        h = detect_heading("Remark 2.")
        assert h is not None
        assert h.weak_label == "other"
        assert h.weak_subtype == "remark"

    def test_notation(self):
        h = detect_heading("Notation.")
        assert h is not None
        assert h.weak_label == "notation"
        assert h.weak_subtype == "notation"

    def test_defn_abbreviation(self):
        h = detect_heading("Defn 3.1.")
        assert h is not None
        assert h.weak_label == "definition"
        assert h.weak_subtype == "defn"

    def test_proposition(self):
        h = detect_heading("Proposition 5.", is_bold=True)
        assert h is not None
        assert h.weak_label == "theorem"
        assert h.weak_subtype == "proposition"

    def test_proof_bold_no_terminator(self):
        """'Proof' on its own line in bold is a heading even without '.'"""
        h = detect_heading("Proof", is_bold=True, is_own_line=True)
        assert h is not None
        assert h.weak_label == "proof"

    def test_heading_at_end_of_line(self):
        """Keyword + number at end of line -> heading (own_line evidence)."""
        h = detect_heading("Theorem 4")
        assert h is not None
        assert h.weak_label == "theorem"
        assert "own_line" in h.heading_evidence

    def test_proof_of_lemma_parenthesised(self):
        h = detect_heading("Proof (of Lemma 3).")
        assert h is not None
        assert h.weak_label == "proof"

    def test_examples_keyword(self):
        h = detect_heading("Examples.")
        assert h is not None
        assert h.weak_label == "example"
        assert h.weak_subtype == "examples"


# -----------------------------------------------------------------------
# NEGATIVE cases — heading is NOT detected
# -----------------------------------------------------------------------

class TestNegativeHeadings:
    """Each of these should return None."""

    def test_theorem_shows(self):
        assert detect_heading("Theorem 2.1 shows that the iterates converge.") is None

    def test_lemma_implies(self):
        assert detect_heading("Lemma 3 implies the bound.") is None

    def test_note_that(self):
        assert detect_heading("Note that f is convex.") is None

    def test_proof_of_concept(self):
        assert detect_heading("Proof of concept implementations exist.") is None

    def test_examples_of(self):
        """'Examples of convex functions include ...' — sentence, not heading."""
        assert detect_heading("Examples of convex functions include ...") is None

    def test_by_definition(self):
        """'By Definition 2.1, x* is regular.' — heading is not at start."""
        assert detect_heading("By Definition 2.1, x* is regular.") is None

    def test_plain_sentence_with_keyword(self):
        assert detect_heading("The example above shows convergence.") is None

    def test_empty(self):
        assert detect_heading("") is None
        assert detect_heading("   ") is None


# -----------------------------------------------------------------------
# text_without_heading
# -----------------------------------------------------------------------

class TestTextWithoutHeading:
    def test_removes_heading_and_terminator(self):
        full = "Definition 2.1 (Regular point). A point x* is regular."
        h = detect_heading(full)
        assert h is not None
        body = remove_heading_from_text(full, h.heading_text)
        assert body.startswith("A point")
        assert "Definition" not in body

    def test_no_heading_returns_unchanged(self):
        text = "This is just a normal paragraph."
        assert remove_heading_from_text(text, None) == text
        assert remove_heading_from_text(text, "") == text

    def test_proof_heading_removed(self):
        full = "Proof. We proceed by induction."
        h = detect_heading(full)
        assert h is not None
        body = remove_heading_from_text(full, h.heading_text)
        assert body.startswith("We proceed")

    def test_theorem_uppercase_removed(self):
        full = "THEOREM 1.25"
        h = detect_heading(full, is_uppercase=True)
        assert h is not None
        body = remove_heading_from_text(full, h.heading_text)
        assert body == "" or body.strip() == ""


# -----------------------------------------------------------------------
# check_mid_block_heading
# -----------------------------------------------------------------------

class TestMidBlockHeading:
    def test_keyword_at_start(self):
        assert check_mid_block_heading("Theorem 3.") is True

    def test_continuation_verb(self):
        assert check_mid_block_heading("Note that x is large.") is False

    def test_no_keyword(self):
        assert check_mid_block_heading("We define the function f.") is False

    def test_lowercase_keyword_rejected(self):
        """P4: lowercase keyword mid-block should also be rejected."""
        assert check_mid_block_heading("definition of chosen ciphertext ...") is False
        assert check_mid_block_heading("lemma.") is False


# -----------------------------------------------------------------------
# P4: Capitalisation — lowercase keywords are NEVER headings
# -----------------------------------------------------------------------

class TestCapitalisation:
    """P4 fix: keyword must start with uppercase."""

    def test_lowercase_definition_rejected(self):
        assert detect_heading("definition of chosen ciphertext ...",
                              is_bold=True) is None

    def test_lowercase_lemma_rejected(self):
        assert detect_heading("lemma.", is_bold=True) is None

    def test_lowercase_proof_rejected(self):
        assert detect_heading("proof. We proceed by induction.",
                              is_bold=True) is None

    def test_lowercase_theorem_rejected(self):
        assert detect_heading("theorem 2.1 shows convergence.") is None

    def test_titlecase_definition_accepted(self):
        h = detect_heading("Definition.", is_bold=True)
        assert h is not None
        assert h.weak_label == "definition"

    def test_uppercase_definition_accepted(self):
        h = detect_heading("DEFINITION.", is_uppercase=True)
        assert h is not None
        assert h.weak_label == "definition"

    def test_mixed_case_not_first_lower(self):
        """'dEFINITION' starts with lowercase -> rejected."""
        assert detect_heading("dEFINITION.", is_bold=True) is None


# -----------------------------------------------------------------------
# P4: Continuation blocks — no heading in continuation
# -----------------------------------------------------------------------

class TestContinuation:
    """P4 fix: is_continuation=True should prevent heading detection."""

    def test_continuation_suppresses_heading(self):
        h = detect_heading("Example 3.4", is_bold=True, is_continuation=True)
        assert h is None

    def test_continuation_false_still_detects(self):
        h = detect_heading("Example 3.4", is_bold=True, is_continuation=False)
        assert h is not None
        assert h.weak_label == "example"


# -----------------------------------------------------------------------
# P4: TOC detection — dot leaders + page number
# -----------------------------------------------------------------------

class TestTocDetection:
    """P4 fix: detect table-of-contents lines."""

    def test_toc_line_algorithm(self):
        assert is_toc_entry(
            "Algorithm 14 K-PKE.Decrypt(dkPKE,c) . . . . . . . . 27"
        )

    def test_toc_line_spaced_dots(self):
        assert is_toc_entry(
            "Algorithm 5 ByteDecode . . . . . . . . . . . . 30"
        )

    def test_not_toc_normal_text(self):
        assert not is_toc_entry("Algorithm 14 K-PKE.Decrypt(dkPKE,c)")

    def test_not_toc_short_dots(self):
        """Fewer than 5 dots should not match."""
        assert not is_toc_entry("Section 2.1 .. 10")

    def test_not_toc_empty(self):
        assert not is_toc_entry("")
        assert not is_toc_entry(None)  # type: ignore[arg-type]


class TestWrappedCrossReference:
    """A '(see Definition 1)' reference wrapped onto a new line is not a heading."""

    def test_unbalanced_parenthesis_after_number_rejected(self):
        assert detect_heading("Definition 1) in the setting where the variances are known",
                              has_font_change=True) is None

    def test_named_heading_with_nested_parentheses_still_accepted(self):
        h = detect_heading("Theorem 3 (Second-Order Conditions for (P2)). Let x be ...", is_bold=True)
        assert h is not None and h.weak_label == "theorem" and h.heading_number == "3"


class TestHeadingLeftovers:
    """Heading fragments must not leak into the heading-free training text."""

    def test_nested_parenthesised_name(self):
        h = detect_heading("Lemma 16 (Martingale SLLN, Hall et al. (2014)) . Let X be a martingale")
        assert h is not None and h.heading_name == "Martingale SLLN, Hall et al. (2014)"
        assert remove_heading_from_text("Lemma 16 (Martingale SLLN, Hall et al. (2014)) . Let X be",
                                        h.heading_text).startswith("Let")

    def test_appendix_number_in_proof_of(self):
        h = detect_heading("Proof of Lemma B.3. Firstly, according to (67), we have")
        assert h is not None and h.heading_name == "of Lemma B.3"
        assert h.heading_text == "Proof of Lemma B.3."

    def test_proof_sketch(self):
        h = detect_heading("Proof sketch. Our algorithm is a standard DP")
        assert h is not None and h.weak_label == "proof" and h.heading_text == "Proof sketch."
        assert detect_heading("Proof Sketch: we leverage Danskin's theorem") is not None
