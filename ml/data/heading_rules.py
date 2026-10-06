"""
heading_rules.py — Detect mathematical/formal headings at the start of text blocks.

Recognises headings like "Definition 2.1 (Regular point).", "THEOREM 1.25",
"Proof.", "Algorithm 7 ML-KEM.KeyGen()", etc.  Returns the weak label,
subtype, heading text, number, name, and evidence list.

Design choices
--------------
* Only the FIRST line of a block is inspected (headings never appear mid-line).
* A keyword must be properly capitalised ("Definition" or "DEFINITION", never
  "definition") — P4 fix: lowercase keywords are NEVER headings.
* A bare keyword ("Proof", "Example") is accepted only with a terminator or
  end-of-line or bold/font-change evidence.  This avoids false positives on
  sentences like "Note that f is convex."
* "Proof of Theorem 2.1." is a valid proof heading (the "of ..." part is
  treated as the heading name).
* Returns None when no heading is found, so callers can use ``if result:``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# Label mapping
# ---------------------------------------------------------------------------

_SUBTYPE_TO_LABEL: dict[str, str] = {
    "definition": "definition",
    "defn": "definition",
    "theorem": "theorem",
    "lemma": "theorem",
    "corollary": "theorem",
    "proposition": "theorem",
    "claim": "theorem",
    "proof": "proof",
    "example": "example",
    "examples": "example",
    "exercise": "example",
    "problem": "example",
    "notation": "notation",
    "algorithm": "algorithm",
    "remark": "other",
    "note": "other",
}

# Sorted longest-first so "examples" is tried before "example", etc.
_KEYWORDS: list[str] = sorted(_SUBTYPE_TO_LABEL.keys(), key=len, reverse=True)

# ---------------------------------------------------------------------------
# Regex components
# ---------------------------------------------------------------------------

# Matches the keyword at the very start of a string (case-insensitive).
# We build this once; it anchors to ^.
_KEYWORD_PATTERN = re.compile(
    r"^(" + "|".join(re.escape(k) for k in _KEYWORDS) + r")\b",
    re.IGNORECASE,
)

# A heading number: "2", "2.1", "1.25", "A.3", "A.3.1"
_NUMBER_PATTERN = re.compile(
    r"^[\s]*([A-Z]?\.?\d+(?:\.\d+)*)"   # also appendix numbers: "B.1"
)

# A function-style name right after the keyword/number: "toInt(", "ML-KEM.KeyGen(",
# and the spaced-underscore form text extraction gives: "wots _ sign (".
_FUNCTION_NAME = re.compile(r"^\s+[\w.\-]+(?:\s*_\s*[\w.\-]+)*\s*\(")

# A parenthesised or bracketed name: "(Regular point)", "[Boneh]"
_NAME_PAREN = re.compile(r"^[\s]*\(([^)]+)\)")
_NAME_BRACKET = re.compile(r"^[\s]*\[([^\]]+)\]")

# "Proof of Theorem 2.1" / "Proof (of Lemma 3)" — special proof-of pattern.
# The regex must NOT consume the trailing terminator ('.' or ':').
# It matches: " of <Word> [<Number>]" optionally wrapped in parens.
_PROOF_OF = re.compile(
    # Words are letters only, so the number "4.1" is consumed whole instead of
    # stopping at "Theorem 4" and leaving ".1." behind.
    r"^[\s]+(?:\()?of\s+[A-Za-z]+(?:\s+[A-Za-z]+)*(?:\s+[A-Z]?\.?\d+(?:\.\d+)*)?(?:\))?",
    re.IGNORECASE,
)

# Terminators: '.' ':' or em-dash (U+2014)
_TERMINATOR = re.compile(r"^[\s]*[.:—]")

# Sentence-continuation words that disqualify a match.
# "Note that ...", "Theorem 2.1 shows ...", "Lemma 3 implies ...",
# "Proof of concept ...", "Example usage ...", "Examples of convex ..."
_CONTINUATION_VERBS = re.compile(
    r"^[\s]+(that|shows?|implies?|gives?|states?|establishes?|ensures?|"
    r"provides?|yields?|says?|asserts?|holds?|follows?|is\b|are\b|was\b|were\b|"
    r"has\b|have\b|can\b|may\b|must\b|should\b|will\b|would\b|shall\b|"
    r"need\b|let\b|if\b|when\b|where\b|which\b|whose\b|since\b|because\b|"
    r"although\b|while\b|for\b|on\b|in\b|at\b|to\b|with\b|by\b|from\b|"
    r"about\b|between\b|usage\b|also\b|further\b|we\b|the\b|this\b|"
    r"our\b|these\b|above\b|below\b|here\b)",
    re.IGNORECASE,
)

# "Proof of concept" is not a heading; "Proof of Theorem 2.1." is.
_PROOF_OF_CONCEPT = re.compile(
    r"^[\s]+of\s+concept\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# TOC detection
# ---------------------------------------------------------------------------

# A TOC entry has dot leaders (5+ dots, possibly space-separated) then a
# page number at the end:
#   "Algorithm 14 K-PKE.Decrypt ....... 27"
_TOC_PATTERN = re.compile(r"(?:\.\s*){5,}\d+\s*$")
# ... or a numbered entry ending in a page number, without leaders:
#   "12 Information Gain 20"
_TOC_NUMBERED = re.compile(r"^(?:\d+(?:\.\d+)*|[A-Z])\s+[A-Za-z][^.]{2,80}?\s+\d{1,4}$")


def is_toc_entry(text: str) -> bool:
    """Return True if *text* looks like a table-of-contents entry.

    TOC entries have dot leaders followed by a page number:
    ``"Algorithm 14 K-PKE.Decrypt ....... 27"``
    """
    if not text:
        return False
    t = text.strip()
    return bool(_TOC_PATTERN.search(t) or _TOC_NUMBERED.match(t))


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class HeadingMatch:
    """Result of a successful heading detection."""
    weak_label: str                     # definition | theorem | proof | ...
    weak_subtype: str                   # lemma | corollary | defn | ...
    heading_text: str                   # exact matched span from the input
    heading_number: Optional[str]       # "2.1" or None
    heading_name: Optional[str]         # "Regular point" or None
    heading_evidence: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_heading(
    text: str,
    *,
    is_bold: bool = False,
    has_font_change: bool = False,
    is_own_line: bool = False,
    is_uppercase: bool = False,
    is_line_start: bool = True,
    is_continuation: bool = False,
) -> Optional[HeadingMatch]:
    """Detect a formal heading at the START of *text*.

    Parameters
    ----------
    text : str
        The text of the first line (or full block text when checking from
        line-start).  Only the beginning is inspected.
    is_bold : bool
        True if the heading words are rendered in bold.
    has_font_change : bool
        True if the heading words use a different font from the rest.
    is_own_line : bool
        True if the heading keyword (+number+name+terminator) occupies an
        entire line by itself (e.g. a Beamer box title).
    is_uppercase : bool
        True if the heading line is in UPPER CASE (e.g. "THEOREM 1.25").
    is_line_start : bool
        If False, the keyword was found in the *middle* of a block (used by
        the caller to flag possible_missed_split).
    is_continuation : bool
        True if this block continues text from the previous page. A
        continuation block never starts a heading (P4 fix).

    Returns
    -------
    HeadingMatch or None
    """
    if not text or not text.strip():
        return None

    # P4: never detect a heading in a continuation block.
    if is_continuation:
        return None

    stripped = text.lstrip()

    m = _KEYWORD_PATTERN.match(stripped)
    if not m:
        return None

    # P4: keyword must be properly capitalised ("Definition" or "DEFINITION",
    # never "definition").  The regex is case-insensitive for matching; we
    # reject lowercase starts here.
    if m.group(1)[0].islower():
        return None

    keyword = m.group(1).lower()
    subtype = keyword  # e.g. "lemma", "defn"
    label = _SUBTYPE_TO_LABEL[subtype]
    pos = m.end()       # position in `stripped` just after keyword
    rest = stripped[pos:]

    heading_number: Optional[str] = None
    heading_name: Optional[str] = None

    # --- Special case: "Proof of concept" is NOT a heading ---
    if subtype == "proof" and _PROOF_OF_CONCEPT.match(rest):
        return None

    # --- Check for continuation verbs (disqualifies heading) ---
    # But only if there's no number first.
    # "Theorem 2.1 shows ..." needs the number consumed first.

    # Try to consume a number
    nm = _NUMBER_PATTERN.match(rest)
    if nm:
        heading_number = nm.group(1)
        rest = rest[nm.end():]

    # After keyword (+ optional number), check for continuation verbs
    # that signal this is a sentence, not a heading.
    if _CONTINUATION_VERBS.match(rest):
        return None

    # "Algorithm B responds..." — short identifier (1–2 chars) followed by
    # a verb signals a sentence reference, not a heading.
    ident_verb_m = re.match(r"^\s+([A-Z]\w?)\s+", rest)
    if ident_verb_m:
        after_ident = rest[ident_verb_m.end():]
        if _CONTINUATION_VERBS.match(" " + after_ident.lstrip()):
            return None

    # A comma after keyword+number signals a sentence reference, not a
    # heading declaration:  "Corollary 4.4, for i >= 1" is NOT a heading.
    if re.match(r"^\s*,", rest):
        return None

    # "Algorithm 1 outlines ...", "Lemma 4.6 excludes ...": keyword and number
    # followed by a lowercase word, with no terminator, is a sentence that
    # mentions the result. ("Algorithm 7 keygen(x)" style names stay allowed.)
    if (
        heading_number
        and not _TERMINATOR.match(rest)
        and re.match(r"^\s+[a-z]", rest)
        and not _FUNCTION_NAME.match(rest)
    ):
        return None

    # "DEFINITION OF A FINITE AUTOMATON", "Examples of ...": a section title
    # or a sentence. Only proofs may continue with "of" ("Proof of Lemma 3.").
    if subtype != "proof" and re.match(r"^\s+of\b", rest, re.IGNORECASE):
        return None

    # "Algorithm B creates ...", "Algorithm MapToPoint works as follows":
    # without a number, an algorithm heading needs a name followed by "("
    # and heading formatting (NIST: "Algorithm BitsToBytes(b)" in bold).
    if subtype == "algorithm" and heading_number is None:
        if not (_FUNCTION_NAME.match(rest) and (is_bold or has_font_change)):
            return None

    # --- "Proof of Theorem 2.1." pattern ---
    if subtype == "proof":
        pof = _PROOF_OF.match(rest)
        if pof:
            heading_name = pof.group(0).strip().lstrip("(").rstrip(")")
            rest = rest[pof.end():]

    # --- Parenthesised / bracketed name ---
    if heading_name is None:
        np = _NAME_PAREN.match(rest)
        if np:
            heading_name = np.group(1).strip()
            rest = rest[np.end():]
        else:
            nb = _NAME_BRACKET.match(rest)
            if nb:
                heading_name = nb.group(1).strip()
                rest = rest[nb.end():]

    # --- Algorithm-specific: function/identifier name after the number ---
    # "Algorithm 7 ML-KEM.KeyGen()" -- the function name is part of the heading.
    # Accept if subtype is "algorithm", there's a number, and the remaining
    # text looks like an identifier (short, no sentence continuation).
    if subtype == "algorithm" and heading_number and heading_name is None:
        remaining = rest.strip()
        if remaining and not _CONTINUATION_VERBS.match(rest):
            heading_name = remaining
            rest = ""

    # --- Evidence and terminator check ---
    evidence: list[str] = ["regex"]

    has_terminator = bool(_TERMINATOR.match(rest))
    at_end_of_line = rest.strip() == ""

    if has_terminator:
        evidence.append("terminator")
    if is_own_line or at_end_of_line:
        evidence.append("own_line")
    if is_bold:
        evidence.append("bold")
    if has_font_change:
        evidence.append("font_change")
    if is_uppercase:
        evidence.append("uppercase")

    # A heading is confirmed only if we have at least one piece of evidence
    # beyond the bare regex match.
    has_structural_evidence = (
        has_terminator
        or at_end_of_line
        or is_own_line
        or is_bold
        or has_font_change
        or is_uppercase
    )
    if not has_structural_evidence:
        return None

    # --- Compute the exact heading_text span ---
    # Everything from the start of stripped up to (and including) the
    # terminator, or up to the end of the keyword+number+name if no terminator.
    heading_end = len(stripped) - len(rest)
    if has_terminator:
        # Include the terminator character itself
        tm = _TERMINATOR.match(rest)
        if tm:
            heading_end += tm.end()

    heading_text = stripped[:heading_end].strip()

    return HeadingMatch(
        weak_label=label,
        weak_subtype=subtype,
        heading_text=heading_text,
        heading_number=heading_number,
        heading_name=heading_name,
        heading_evidence=evidence,
    )


def remove_heading_from_text(full_text: str, heading_text: str) -> str:
    """Remove the heading (and any trailing whitespace/terminator) from the
    beginning of *full_text*, returning the body text.

    If *heading_text* is None or empty, returns *full_text* unchanged.
    """
    if not heading_text:
        return full_text

    stripped = full_text.lstrip()
    if stripped.startswith(heading_text):
        after = stripped[len(heading_text):]
        # Also strip a trailing terminator that wasn't included in heading_text
        after = re.sub(r"^[\s.:—]*", "", after, count=1)
        return after.strip() if after.strip() else after
    # Fallback: heading_text might have been normalised differently
    return full_text


def check_mid_block_heading(line_text: str, **kwargs) -> bool:
    """Check whether *line_text* starts with a heading keyword.

    Used to flag ``possible_missed_split`` when a heading keyword appears
    at the start of a line that is NOT the first line of its block.
    Returns True if a heading keyword is found (regardless of evidence).
    """
    if not line_text or not line_text.strip():
        return False
    stripped = line_text.lstrip()
    m = _KEYWORD_PATTERN.match(stripped)
    if not m:
        return False
    # P4: reject lowercase keywords
    if m.group(1)[0].islower():
        return False
    keyword = m.group(1).lower()
    rest = stripped[m.end():]
    # Consume optional number
    nm = _NUMBER_PATTERN.match(rest)
    if nm:
        rest = rest[nm.end():]
    # Disqualify continuation verbs
    if _CONTINUATION_VERBS.match(rest):
        return False
    # Short identifier + verb = sentence reference
    ident_verb_m = re.match(r"^\s+([A-Z]\w?)\s+", rest)
    if ident_verb_m:
        after_ident = rest[ident_verb_m.end():]
        if _CONTINUATION_VERBS.match(" " + after_ident.lstrip()):
            return False
    # Comma after keyword+number = sentence reference
    if re.match(r"^\s*,", rest):
        return False
    if keyword == "proof" and _PROOF_OF_CONCEPT.match(rest):
        return False
    return True
