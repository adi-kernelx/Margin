"""ML2.14: sentence splitting for PDF block text.

A prose definition is usually one sentence inside a paragraph, so the detector
scores sentences, not blocks. Splits after '.', '!' or '?' followed by space and
a capital letter or bracket, except after common abbreviations ("e.g.", "i.e.",
"et al.", "Fig.", "Eq.", "Thm.", "resp.") and after a lone capital initial ("J.")
or a section number ("2.1.").
"""

import re

ABBREVIATIONS = ("e.g.", "i.e.", "et al.", "etc.", "cf.", "resp.", "fig.", "figs.", "eq.", "eqs.", "thm.",
                 "def.", "sec.", "lem.", "prop.", "cor.", "no.", "vs.", "ref.", "refs.", "ch.", "vol.", "pp.", "p.")
_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\[“\"])")


def split_sentences(text):
    """Split block text into sentences; never returns an empty list for nonempty text."""
    text = " ".join(text.split())
    if not text:
        return []
    pieces, start = [], 0
    for match in _BOUNDARY.finditer(text):
        before = text[start:match.start()]
        last = before.rsplit(" ", 1)[-1].lower()
        if last in ABBREVIATIONS or re.fullmatch(r"[a-z]\.", last) or re.fullmatch(r"\d+(\.\d+)*\.", last):
            continue
        pieces.append(before.strip())
        start = match.end()
    pieces.append(text[start:].strip())
    return [piece for piece in pieces if piece]
