#!/usr/bin/env python3
"""
extract_blocks.py — CLI that splits PDFs into text blocks, extracts layout
features, assigns weak labels from headings, and writes JSONL + report + overlays.

This is STEP 1 of the ML data pipeline: deterministic data extraction only.
No model training, no OCR, no LLM calls, no ML libraries.

Usage
-----
    python ml/data/extract_blocks.py \
        --manifest "Test PDFs/manifest.csv" \
        --pdf-dir  "Test PDFs" \
        --out      ml/out \
        --only "file1.pdf" "file2.pdf:53-100"

(":a-b" after a file name = 1-based inclusive page range.)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import random
import re
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Any

import pymupdf                    # PyMuPDF >= 1.28

# Ensure sibling module is importable when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from ml.data.heading_rules import (
    detect_heading,
    remove_heading_from_text,
    check_mid_block_heading,
    is_toc_entry,
)

# ======================================================================
# Constants
# ======================================================================

# Ligature replacement map (presentation forms → plain ASCII).
_LIGATURES: dict[str, str] = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",   # ſt ligature (rare)
    "\ufb06": "st",
}

_USER_ANNOT_TYPES = {0, 2, 13, 14, 20}  # Text, FreeText, Stamp, Caret, Widget

_ANNOT_TYPE_NAMES = {
    0: "Text",
    2: "FreeText",
    13: "Stamp",
    14: "Caret",
    20: "Widget",
}

# Unicode ranges considered "math characters" (Greek, math operators,
# math symbols, math alphanumeric, arrows, misc technical).
def _is_math_char(ch: str) -> bool:
    """Return True if *ch* is a Greek letter, math symbol, or math operator."""
    cp = ord(ch)
    return (
        0x0370 <= cp <= 0x03FF          # Greek and Coptic
        or 0x1D00 <= cp <= 0x1D7F       # Phonetic Extensions
        or 0x2100 <= cp <= 0x214F       # Letterlike Symbols
        or 0x2190 <= cp <= 0x21FF       # Arrows
        or 0x2200 <= cp <= 0x22FF       # Mathematical Operators
        or 0x2300 <= cp <= 0x23FF       # Misc Technical
        or 0x27C0 <= cp <= 0x27EF       # Misc Mathematical Symbols-A
        or 0x2980 <= cp <= 0x29FF       # Misc Mathematical Symbols-B
        or 0x2A00 <= cp <= 0x2AFF       # Supplemental Mathematical Operators
        or 0x1D400 <= cp <= 0x1D7FF     # Mathematical Alphanumeric Symbols
        or 0x00B1 == cp                 # ±
        or 0x00D7 == cp                 # ×
        or 0x00F7 == cp                 # ÷
        or 0x2260 <= cp <= 0x226F       # ≠ ≤ ≥ etc.
    )


# ======================================================================
# Text cleaning
# ======================================================================

def clean_text(raw: str) -> str:
    """Replace ligatures and collapse whitespace.  No NFKC normalisation."""
    out = raw
    for lig, repl in _LIGATURES.items():
        out = out.replace(lig, repl)
    # Collapse runs of whitespace (but keep newlines as-is for now).
    out = re.sub(r"[^\S\n]+", " ", out)
    return out


def join_hyphenated(lines: list[str]) -> str:
    """Join a list of line texts, merging hyphenated line breaks.

    A trailing hyphen is removed and the lines are glued when the next
    line starts with a lowercase letter (``optimi-`` + ``zation`` →
    ``optimization``).  Otherwise a space is inserted.
    """
    if not lines:
        return ""
    parts: list[str] = [lines[0]]
    for i in range(1, len(lines)):
        prev = parts[-1]
        curr = lines[i]
        if prev.endswith("-") and curr and curr[0].islower():
            parts[-1] = prev[:-1]  # remove trailing hyphen
            parts.append(curr)
        else:
            parts.append(" " + curr)
    return "".join(parts)


# ======================================================================
# Span and Line extraction
# ======================================================================

@dataclass
class SpanInfo:
    text: str
    bbox: tuple[float, float, float, float]
    font_name: str
    font_size: float
    bold: bool
    italic: bool
    mono: bool


@dataclass
class VisualLine:
    spans: list[SpanInfo]
    text: str
    bbox: tuple[float, float, float, float]
    page_idx: int
    page_num: int
    column: int
    font_size: float
    font_name: str
    bold: bool
    italic: bool
    mono: bool
    n_chars: int
    bold_chars: int
    italic_chars: int
    mono_chars: int
    is_display_math: bool = False


def _vertical_overlap_fraction(bbox_a: tuple[float, float, float, float], bbox_b: tuple[float, float, float, float]) -> float:
    top = max(bbox_a[1], bbox_b[1])
    bot = min(bbox_a[3], bbox_b[3])
    overlap = max(0.0, bot - top)
    min_h = min(bbox_a[3] - bbox_a[1], bbox_b[3] - bbox_b[1])
    return overlap / min_h if min_h > 0 else 0.0


def extract_spans(page: pymupdf.Page) -> tuple[list[SpanInfo], dict[str, int], int]:
    """Extract spans, filter out those overlapping with annotations."""
    annot_counts = Counter()
    annot_rects = []
    
    for annot in page.annots():
        if annot.type[0] in _USER_ANNOT_TYPES:
            type_name = _ANNOT_TYPE_NAMES.get(annot.type[0], str(annot.type[0]))
            annot_counts[type_name] += 1
            annot_rects.append(annot.rect)
            
    data = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
    spans_info: list[SpanInfo] = []
    dropped = 0
    
    for blk in data.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for line in blk.get("lines", []):
            # Rotated text (the arXiv stamp in the margin, vertical labels)
            # is not part of the reading flow.
            if abs(line.get("dir", (1.0, 0.0))[1]) > 0.1:
                continue
            for sp in line.get("spans", []):
                text = clean_text(sp.get("text", ""))
                if not text.strip():
                    continue
                
                bbox = sp["bbox"]
                span_rect = pymupdf.Rect(bbox)
                
                # Check annotation intersection
                skip = False
                span_area = span_rect.get_area()
                if span_area > 0:
                    for arect in annot_rects:
                        intersect = span_rect & arect
                        if not intersect.is_empty and intersect.get_area() >= 0.5 * span_area:
                            skip = True
                            break
                if skip:
                    dropped += 1
                    continue
                
                flags = sp.get("flags", 0)
                is_bold = bool(flags & 16)
                is_italic = bool(flags & 2)
                is_mono = bool(flags & 8)
                
                spans_info.append(SpanInfo(
                    text=text,
                    bbox=tuple(bbox),
                    font_name=sp.get("font", ""),
                    font_size=sp.get("size", 10.0),
                    bold=is_bold,
                    italic=is_italic,
                    mono=is_mono
                ))
                
    return spans_info, dict(annot_counts), dropped


def build_rows(spans: list[SpanInfo]) -> list[list[SpanInfo]]:
    """Cluster spans into visual rows across the whole page.

    A span joins the row whose *core band* it overlaps most (>= 40% of the
    smaller height). Only ordinary-height spans of the row's body size may
    widen the core band. Tall glyphs (big brackets, integral signs, operators
    with limits) and sub/superscripts join a row without stretching it;
    otherwise one tall glyph makes a row swallow the lines above and below
    and their words get interleaved.
    """
    def tall(s: SpanInfo) -> bool:
        return (s.bbox[3] - s.bbox[1]) > 1.4 * s.font_size

    rows: list[list[SpanInfo]] = []
    cores: list[list[float]] = []   # [y0, y1] of the row's ordinary spans
    sizes: list[float] = []         # body font size per row

    # Ordinary spans first, so every row's core is set by normal text.
    order = sorted(spans, key=lambda s: (tall(s), (s.bbox[1] + s.bbox[3]) / 2, s.bbox[0]))
    for s in order:
        best, best_overlap = -1, 0.0
        for i, core in enumerate(cores):
            ov = _vertical_overlap_fraction(s.bbox, (0.0, core[0], 0.0, core[1]))
            if ov > best_overlap:
                best, best_overlap = i, ov
        if best >= 0 and best_overlap >= 0.4:
            rows[best].append(s)
            if not tall(s) and 0.85 * sizes[best] <= s.font_size <= 1.2 * sizes[best]:
                core_h = cores[best][1] - cores[best][0]
                if (s.bbox[3] - s.bbox[1]) <= 1.3 * core_h:
                    cores[best][0] = min(cores[best][0], s.bbox[1])
                    cores[best][1] = max(cores[best][1], s.bbox[3])
        else:
            rows.append([s])
            cores.append([s.bbox[1], s.bbox[3]])
            sizes.append(s.font_size)

    rows = _attach_script_rows(rows)
    for row in rows:
        row.sort(key=lambda s: s.bbox[0])
    return rows


def _attach_script_rows(rows: list[list[SpanInfo]]) -> list[list[SpanInfo]]:
    """Merge rows made only of small text (subscripts that hang below the
    baseline, limits under a sum) into the nearest full-size row, if it is
    within half a body line. Otherwise "i i 2 i+1" becomes a block of its own."""
    weights: Counter = Counter()
    for row in rows:
        for s in row:
            weights[round(s.font_size, 1)] += len(s.text)
    if not weights:
        return rows
    body_size = weights.most_common(1)[0][0]

    def is_script_row(row: list[SpanInfo]) -> bool:
        return max(s.font_size for s in row) < 0.85 * body_size

    def band(row: list[SpanInfo]) -> tuple[float, float]:
        return min(s.bbox[1] for s in row), max(s.bbox[3] for s in row)

    full = [r for r in rows if not is_script_row(r)]
    if not full:
        return rows
    for row in rows:
        if not is_script_row(row):
            continue
        y0, y1 = band(row)
        best, best_gap = None, 0.5 * body_size
        for target in full:
            t0, t1 = band(target)
            gap = max(t0 - y1, y0 - t1, 0.0)
            # Must overlap horizontally with the target's extent.
            tx0 = min(s.bbox[0] for s in target)
            tx1 = max(s.bbox[2] for s in target)
            rx0 = min(s.bbox[0] for s in row)
            rx1 = max(s.bbox[2] for s in row)
            if rx1 < tx0 or rx0 > tx1:
                continue
            if gap <= best_gap:
                best, best_gap = target, gap
        if best is not None:
            best.extend(row)
        else:
            full.append(row)
    return full


def detect_gutter(rows: list[list[SpanInfo]], page_width: float) -> Optional[float]:
    """Return the x of a two-column gutter, or None for a single-column page.

    A page is two-column only if some x near the centre (0.40W..0.60W) is
    free of text in at least 75% of the rows (full-width
    figures and titles take the rest), while at least 30% of the rows
    have text on each side of it. Counting rows, not spans, matters: maths
    pages have hundreds of tiny spans that sit wholly left or right of the
    centre even though every line runs across it.
    """
    if page_width <= 0 or len(rows) < 6:
        return None

    # A gutter must be wider than a word space, otherwise the gap between two
    # words that happen to line up vertically would count as one.
    min_gap = 0.015 * page_width

    def is_free(row: list[SpanInfo], x: float) -> bool:
        if any(s.bbox[0] < x < s.bbox[2] for s in row):
            return False
        left_edge = max((s.bbox[2] for s in row if s.bbox[2] <= x), default=None)
        right_edge = min((s.bbox[0] for s in row if s.bbox[0] >= x), default=None)
        if left_edge is None or right_edge is None:
            return True  # the row sits wholly on one side
        return right_edge - left_edge >= min_gap

    best_x, best_free = None, 0.0
    steps = 41
    for k in range(steps):
        x = page_width * (0.40 + 0.20 * k / (steps - 1))
        free = left = right = 0
        for row in rows:
            if is_free(row, x):
                free += 1
            if any(s.bbox[2] <= x for s in row):
                left += 1
            if any(s.bbox[0] >= x for s in row):
                right += 1
        n = len(rows)
        if free / n >= 0.75 and left / n >= 0.3 and right / n >= 0.3 and free / n > best_free:
            best_x, best_free = x, free / n
    return best_x


def _make_visual_line(
    spans: list[SpanInfo], column: int, page_idx: int, page_num: int,
) -> Optional[VisualLine]:
    """Build a VisualLine from spans already sorted left to right."""
    text = re.sub(r"[^\S\n]+", " ", " ".join(s.text for s in spans)).strip()
    if not text:
        return None

    bbox = (
        min(s.bbox[0] for s in spans),
        min(s.bbox[1] for s in spans),
        max(s.bbox[2] for s in spans),
        max(s.bbox[3] for s in spans),
    )

    # Line size = character-weighted median, ignoring sub/superscripts.
    max_size = max(s.font_size for s in spans)
    body = [s for s in spans if s.font_size >= 0.8 * max_size] or spans
    sizes = sorted(size for s in body for size in [s.font_size] * len(s.text))
    font_size = sizes[len(sizes) // 2] if sizes else 10.0

    total_chars = sum(len(s.text) for s in spans)
    bold_chars = sum(len(s.text) for s in spans if s.bold)
    italic_chars = sum(len(s.text) for s in spans if s.italic)
    mono_chars = sum(len(s.text) for s in spans if s.mono)
    font_names: Counter = Counter()
    for s in spans:
        font_names[s.font_name] += len(s.text)

    return VisualLine(
        spans=spans,
        text=text,
        bbox=bbox,
        page_idx=page_idx,
        page_num=page_num,
        column=column,
        font_size=font_size,
        font_name=font_names.most_common(1)[0][0] if font_names else "",
        bold=bold_chars > total_chars / 2,
        italic=italic_chars > total_chars / 2,
        mono=mono_chars > total_chars / 2,
        n_chars=total_chars,
        bold_chars=bold_chars,
        italic_chars=italic_chars,
        mono_chars=mono_chars,
    )


def build_visual_lines(
    spans: list[SpanInfo], page_idx: int, page_num: int, page_width: float,
) -> tuple[int, list[VisualLine]]:
    """Spans -> visual lines in reading order.

    Rows are built for the whole page first; only if a real gutter exists are
    rows split into a left and a right column. Reading order is then: left
    column top-down, then right column top-down, with full-width rows (titles,
    wide equations) acting as separators between such sections.
    """
    rows = build_rows(spans)
    rows.sort(key=lambda r: min(s.bbox[1] for s in r))
    gutter = detect_gutter(rows, page_width)

    lines: list[VisualLine] = []

    def emit(row_spans: list[SpanInfo], column: int) -> None:
        line = _make_visual_line(row_spans, column, page_idx, page_num)
        if line:
            lines.append(line)

    if gutter is None:
        for row in rows:
            emit(row, 0)
        n_cols = 1
    else:
        left: list[list[SpanInfo]] = []
        right: list[list[SpanInfo]] = []

        def flush() -> None:
            for r in left:
                emit(r, 0)
            for r in right:
                emit(r, 1)
            left.clear()
            right.clear()

        for row in rows:
            if any(s.bbox[0] < gutter < s.bbox[2] for s in row):
                flush()
                emit(row, 0)  # full-width row
                continue
            l_part = [s for s in row if s.bbox[2] <= gutter]
            r_part = [s for s in row if s.bbox[0] >= gutter]
            if l_part:
                left.append(l_part)
            if r_part:
                right.append(r_part)
        flush()
        n_cols = 2

    _mark_display_math(lines, page_width)
    return n_cols, lines


def _mark_display_math(visual_lines: list[VisualLine], page_width: float) -> None:
    """Flag centred equations, operator limits and similar non-prose rows."""
    line_heights = [l.bbox[3] - l.bbox[1] for l in visual_lines if l.bbox[3] - l.bbox[1] > 0]
    median_lh = statistics.median(line_heights) if line_heights else 12.0

    for vl in visual_lines:
        text_stripped = vl.text.replace(" ", "")
        n_non_ws = len(text_stripped)
        if n_non_ws == 0:
            continue
        math_count = sum(1 for ch in text_stripped if _is_math_char(ch))
        digit_count = sum(1 for ch in text_stripped if ch.isdigit())
        alpha_count = sum(1 for ch in text_stripped if ch.isalpha() and not _is_math_char(ch))
        centred = vl.bbox[0] > page_width * 0.15 and (page_width - vl.bbox[2]) > page_width * 0.15
        line_height = vl.bbox[3] - vl.bbox[1]

        if centred and (math_count / n_non_ws > 0.3 or n_non_ws < 30):
            vl.is_display_math = True
        elif n_non_ws < 8 and (math_count + digit_count) > alpha_count:
            vl.is_display_math = True
        elif n_non_ws < 15 and line_height < 0.7 * median_lh and math_count > 0:
            vl.is_display_math = True


# ======================================================================
# Furniture detection (running headers, footers, page numbers)
# ======================================================================

def _normalise_for_furniture(text: str) -> str:
    """Normalise text for furniture comparison: digits→#, lowercase, strip."""
    t = re.sub(r"\d+", "#", text.strip().lower())
    return t.strip()


def detect_furniture(
    all_lines: list[VisualLine],
    page_height: float,
    n_pages: int,
) -> set[tuple[int, int]]:
    """Identify furniture lines (headers/footers that repeat across pages)."""
    page_lines: dict[int, list[tuple[int, VisualLine]]] = defaultdict(list)
    for i, li in enumerate(all_lines):
        page_lines[li.page_idx].append((i, li))

    TOP_FRAC = 0.10
    BOTTOM_FRAC = 0.10
    top_threshold = page_height * TOP_FRAC
    bottom_threshold = page_height * (1 - BOTTOM_FRAC)

    freq_odd: dict[str, set[int]] = defaultdict(set)
    freq_even: dict[str, set[int]] = defaultdict(set)
    freq_all: dict[str, set[int]] = defaultdict(set)
    norm_map: dict[tuple[int, int], str] = {}

    for pg, items in page_lines.items():
        is_odd = (pg + 1) % 2 == 1
        for global_idx, li in items:
            y_mid = (li.bbox[1] + li.bbox[3]) / 2
            if y_mid < top_threshold or y_mid > bottom_threshold:
                nt = _normalise_for_furniture(li.text)
                if nt:
                    freq_all[nt].add(pg)
                    if is_odd:
                        freq_odd[nt].add(pg)
                    else:
                        freq_even[nt].add(pg)
                    norm_map[(pg, global_idx)] = nt

    n_odd = sum(1 for p in range(n_pages) if (p+1)%2 == 1)
    n_even = n_pages - n_odd
    
    min_pages_all = max(2, int(n_pages * 0.30))
    min_pages_odd = max(2, int(n_odd * 0.30)) if n_odd > 0 else 9999
    min_pages_even = max(2, int(n_even * 0.30)) if n_even > 0 else 9999

    furniture_norms: set[str] = set()
    for nt, pages_set in freq_all.items():
        if len(pages_set) >= min_pages_all:
            furniture_norms.add(nt)
    for nt, pages_set in freq_odd.items():
        if len(pages_set) >= min_pages_odd:
            furniture_norms.add(nt)
    for nt, pages_set in freq_even.items():
        if len(pages_set) >= min_pages_even:
            furniture_norms.add(nt)

    _PAGE_NUM_RE = re.compile(r"^\s*\d+\s*$")

    furniture: set[tuple[int, int]] = set()
    for pg, items in page_lines.items():
        for global_idx, li in items:
            key = (pg, global_idx)
            if key in norm_map and norm_map[key] in furniture_norms:
                furniture.add(key)
            elif _PAGE_NUM_RE.match(li.text):
                furniture.add(key)

    return furniture


# ======================================================================
# Block grouping
# ======================================================================

@dataclass
class RawBlock:
    lines: list[VisualLine] = field(default_factory=list)
    column: int = 0
    page_idx: int = 0
    page_num: int = 0


_SENTENCE_END = tuple(".:!?)]}∎□■") 


def page_body_font(lines: list[VisualLine]) -> str:
    """The font carrying most characters on the page (the body text font)."""
    fonts: Counter = Counter()
    for li in lines:
        for s in li.spans:
            fonts[s.font_name] += len(s.text)
    return fonts.most_common(1)[0][0] if fonts else ""


def line_heading(
    line: VisualLine,
    prev_line: Optional[VisualLine],
    body_font: str,
    *,
    is_continuation: bool = False,
):
    """Heading detection for one visual line, with evidence from its spans.

    Evidence comes from the keyword's OWN span: bold, or a font different from
    the page body font (amsthm sets "Lemma 4.6." in bold and "Proof." in
    italic). A line that merely starts with a reference, e.g. a wrapped
    "... by Construction / Lemma 4.6 excludes ...", has the keyword in the body
    font and follows a line that did not end a sentence, so it is rejected.
    """
    first = line.spans[0]
    kw_bold = first.bold
    kw_font_change = bool(body_font) and first.font_name != body_font
    first_word = line.text.split()[0] if line.text.split() else ""
    is_upper = first_word.isupper() and len(first_word) > 3

    h = detect_heading(
        line.text,
        is_bold=kw_bold,
        has_font_change=kw_font_change,
        is_own_line=False,
        is_uppercase=is_upper,
        is_line_start=True,
        is_continuation=is_continuation,
    )
    if h is None:
        return None

    formatted = kw_bold or kw_font_change or is_upper
    prev_ends_sentence = (
        prev_line is None
        or prev_line.is_display_math
        or prev_line.text.rstrip().endswith(_SENTENCE_END)
    )
    if not formatted and not prev_ends_sentence:
        return None
    return h


def group_lines_into_blocks(
    lines: list[VisualLine],
    page_width: float,
    page_height: float,
    n_cols: int,
    is_toc_page: bool,
    body_font: str = "",
) -> list[RawBlock]:
    """Group lines into blocks for a single page, in reading order."""
    if not lines:
        return []

    line_heights = [li.bbox[3] - li.bbox[1] for li in lines if (li.bbox[3] - li.bbox[1]) > 0]
    median_lh = statistics.median(line_heights) if line_heights else 12.0

    # Normal leading of the page. In a double-spaced document the ordinary gap
    # between two lines (~1 line height) is larger than the fixed threshold,
    # so the threshold must grow with it, and paragraphs are then found by
    # their short last line instead.
    gaps = [
        b.bbox[1] - a.bbox[3]
        for a, b in zip(lines, lines[1:])
        if a.column == b.column and 0 < b.bbox[1] - a.bbox[3] < 3 * median_lh
    ]
    median_gap = statistics.median(gaps) if gaps else 0.0
    gap_threshold = max(0.8 * median_lh, median_gap + 0.5 * median_lh)
    double_spaced = median_gap > 0.5 * median_lh
    col_right: dict[int, float] = defaultdict(float)
    for li in lines:
        col_right[li.column] = max(col_right[li.column], li.bbox[2])

    blocks: list[RawBlock] = []
    current = RawBlock(
        lines=[lines[0]],
        column=lines[0].column,
        page_idx=lines[0].page_idx,
        page_num=lines[0].page_num,
    )

    for i in range(1, len(lines)):
        prev_line = lines[i - 1]
        curr_line = lines[i]
        curr_col = curr_line.column

        start_new = False
        
        if curr_col != current.column:
            start_new = True

        if not start_new:
            gap = curr_line.bbox[1] - prev_line.bbox[3]
            if gap > gap_threshold:
                if not curr_line.is_display_math:
                    start_new = True
            elif double_spaced and not curr_line.is_display_math:
                # Paragraph end: the previous line finished a sentence well
                # short of the column's right edge.
                width = col_right[prev_line.column] - prev_line.bbox[0]
                short = prev_line.bbox[2] < col_right[prev_line.column] - 0.1 * max(width, 1.0)
                if short and prev_line.text.rstrip().endswith((".", ":", "!", "?")):
                    start_new = True

        if not start_new and not curr_line.is_display_math:
            if prev_line.font_size > 0 and abs(curr_line.font_size - prev_line.font_size) / prev_line.font_size > 0.20:
                start_new = True

        # A heading always starts a new block.
        if not is_toc_page and line_heading(curr_line, prev_line, body_font):
            start_new = True

        if start_new:
            blocks.append(current)
            current = RawBlock(
                lines=[curr_line],
                column=curr_col,
                page_idx=curr_line.page_idx,
                page_num=curr_line.page_num,
            )
        else:
            current.lines.append(curr_line)

    blocks.append(current)

    # Merge lone-heading blocks
    merged: list[RawBlock] = []
    i = 0
    while i < len(blocks):
        blk = blocks[i]
        if len(blk.lines) <= 2 and not is_toc_page:
            blk_text = " ".join(l.text for l in blk.lines).strip()
            h = None
            if line_heading(blk.lines[0], None, body_font):
                # Lone heading: the whole block is just the heading words.
                h = detect_heading(blk_text, is_own_line=True)
                if h and remove_heading_from_text(blk_text, h.heading_text).strip():
                    h = None
            if h and i + 1 < len(blocks):
                next_blk = blocks[i + 1]
                if next_blk.column == blk.column:
                    next_blk.lines = blk.lines + next_blk.lines
                    i += 1
                    continue
        merged.append(blk)
        i += 1

    return merged


def _is_pseudo_code_line(text: str) -> bool:
    t = text.strip()
    if re.match(r"^\d+:", t): return True
    if t.startswith("Input") or t.startswith("Output"): return True
    if any(ch in t for ch in ["▷", "◁", "▶", "◀", "▹", "◃", "▸", "◂", "△", "▽"]): return True
    words = t.split()
    if words:
        w = words[0].strip(",")
        if w in {"for", "while", "if", "return", "end"}: return True
    return False


def extend_algorithm_blocks(blocks: list[RawBlock], median_lh: float, body_font: str = "") -> list[RawBlock]:
    """After an "Algorithm N" heading, absorb the following pseudo-code blocks
    (numbered lines, Input/Output, comments) until the next heading or a gap
    of more than 2 line heights."""
    merged: list[RawBlock] = []
    i = 0
    while i < len(blocks):
        blk = blocks[i]
        h = line_heading(blk.lines[0], None, body_font)
        if h and h.weak_label == "algorithm":
            j = i + 1
            while j < len(blocks):
                next_blk = blocks[j]
                if line_heading(next_blk.lines[0], None, body_font):
                    break
                if next_blk.lines[0].bbox[1] - blk.lines[-1].bbox[3] > 2.0 * median_lh:
                    break
                if not any(_is_pseudo_code_line(l.text) for l in next_blk.lines):
                    break
                blk.lines.extend(next_blk.lines)
                j += 1
            i = j - 1
        merged.append(blk)
        i += 1
    return merged


# ======================================================================
# Feature extraction
# ======================================================================

def _normalise_bbox(bbox: tuple[float, ...], page_width: float, page_height: float) -> dict:
    return {
        "x0": round(max(0.0, min(1.0, bbox[0] / page_width)), 4),
        "y0": round(max(0.0, min(1.0, bbox[1] / page_height)), 4),
        "x1": round(max(0.0, min(1.0, bbox[2] / page_width)), 4),
        "y1": round(max(0.0, min(1.0, bbox[3] / page_height)), 4),
    }


@dataclass
class BlockRecord:
    block_id: str
    file: str
    group: str
    category: str
    page: int
    block_index: int
    bbox: dict
    column: int
    text: str
    text_without_heading: str
    lines: list[str]
    n_lines: int
    n_chars: int
    font_size_median: float
    font_size_rel: float
    bold_ratio: float
    italic_ratio: float
    mono_ratio: float
    math_char_ratio: float
    indent_rel: float
    gap_above_rel: float
    weak_label: Optional[str]
    weak_subtype: Optional[str]
    heading_text: Optional[str]
    heading_number: Optional[str]
    heading_name: Optional[str]
    heading_evidence: list[str]
    possible_missed_split: bool
    continues_previous: bool
    flags: list[str]


def compute_block_record(
    block: RawBlock,
    block_index: int,
    file_name: str,
    group: str,
    category: str,
    page_width: float,
    page_height: float,
    page_median_font_size: float,
    page_body_left: float,
    page_median_lh: float,
    prev_block_y1: Optional[float],
    is_toc_page: bool,
    is_continuation: bool,
    body_font: str = "",
) -> BlockRecord:
    line_texts = [l.text for l in block.lines]
    text = join_hyphenated(line_texts)
    n_chars = sum(l.n_chars for l in block.lines)

    first_line = block.lines[0]
    first_text = first_line.text

    heading = None
    if not is_toc_page:
        heading = line_heading(first_line, None, body_font, is_continuation=is_continuation)
        if heading is None and len(block.lines) >= 2:
            # A lone heading line merged with its body ("Theorem 1." / "DEFINITION").
            lone = detect_heading(first_text, is_own_line=True, is_continuation=is_continuation)
            if lone and not remove_heading_from_text(first_text, lone.heading_text).strip():
                heading = lone

        # Heading number in separate span/row
        if heading and not heading.heading_number:
            if len(block.lines) > 1:
                next_line = block.lines[1]
                gap = next_line.bbox[1] - first_line.bbox[3]
                if gap < 1.0 * page_median_lh:
                    if re.match(r"^[\d\.]+$", next_line.text.strip()):
                        heading.heading_number = next_line.text.strip()
                        heading.heading_text = f"{heading.heading_text} {heading.heading_number}"
                        
    weak_label = heading.weak_label if heading else None
    weak_subtype = heading.weak_subtype if heading else None
    heading_text = heading.heading_text if heading else None
    heading_number = heading.heading_number if heading else None
    heading_name = heading.heading_name if heading else None
    heading_evidence = heading.heading_evidence if heading else []

    text_without_heading = remove_heading_from_text(text, heading_text) if heading else text

    possible_missed_split = False
    if not is_toc_page:
        for prev_li, li in zip(block.lines, block.lines[1:]):
            if line_heading(li, prev_li, body_font):
                possible_missed_split = True
                break

    if heading and heading.heading_text and text_without_heading.lstrip().startswith(heading.heading_text):
        # "Lemma 4.2. Lemma 4.2." - the heading is repeated; worth a look.
        duplicate_heading = True
    else:
        duplicate_heading = False

    raw_bbox = (
        min(l.bbox[0] for l in block.lines),
        min(l.bbox[1] for l in block.lines),
        max(l.bbox[2] for l in block.lines),
        max(l.bbox[3] for l in block.lines),
    )
    bbox = _normalise_bbox(raw_bbox, page_width, page_height)

    all_sizes = [l.font_size for l in block.lines]
    font_size_median = round(statistics.median(all_sizes), 1) if all_sizes else 10.0
    font_size_rel = round(font_size_median / page_median_font_size, 2) if page_median_font_size > 0 else 1.0

    total_chars = max(n_chars, 1)
    bold_chars = sum(l.bold_chars for l in block.lines)
    italic_chars = sum(l.italic_chars for l in block.lines)
    mono_chars = sum(l.mono_chars for l in block.lines)
    bold_ratio = round(bold_chars / total_chars, 2)
    italic_ratio = round(italic_chars / total_chars, 2)
    mono_ratio = round(mono_chars / total_chars, 2)

    math_chars = sum(1 for ch in text if _is_math_char(ch))
    math_char_ratio = round(math_chars / max(len(text), 1), 2)

    indent_rel = round((raw_bbox[0] - page_body_left) / page_width, 3) if page_width > 0 else 0.0

    if prev_block_y1 is not None and page_median_lh > 0:
        gap_above = raw_bbox[1] - prev_block_y1
        gap_above_rel = round(gap_above / page_median_lh, 1)
    else:
        gap_above_rel = 0.0

    flags: list[str] = []
    if len(text) < 15:
        flags.append("very_short")
    if len(text) > 2000:
        flags.append("very_long")
    if math_char_ratio > 0.3:
        flags.append("mostly_math")
    if mono_ratio > 0.5:
        flags.append("mostly_mono")
    if bold_ratio > 0.8:
        flags.append("mostly_bold")
    if duplicate_heading:
        flags.append("duplicate_heading")

    id_str = f"{file_name}|{block.page_num}|{block_index}"
    block_id = hashlib.sha256(id_str.encode("utf-8")).hexdigest()[:16]

    return BlockRecord(
        block_id=block_id,
        file=file_name,
        group=group,
        category=category,
        page=block.page_num,
        block_index=block_index,
        bbox=bbox,
        column=block.column,
        text=text,
        text_without_heading=text_without_heading,
        lines=line_texts,
        n_lines=len(block.lines),
        n_chars=n_chars,
        font_size_median=font_size_median,
        font_size_rel=font_size_rel,
        bold_ratio=bold_ratio,
        italic_ratio=italic_ratio,
        mono_ratio=mono_ratio,
        math_char_ratio=math_char_ratio,
        indent_rel=indent_rel,
        gap_above_rel=gap_above_rel,
        weak_label=weak_label,
        weak_subtype=weak_subtype,
        heading_text=heading_text,
        heading_number=heading_number,
        heading_name=heading_name,
        heading_evidence=heading_evidence,
        possible_missed_split=possible_missed_split,
        continues_previous=is_continuation,
        flags=flags,
    )


# ======================================================================
# Process one PDF
# ======================================================================

@dataclass
class FileResult:
    file_name: str
    group: str
    category: str
    pages_processed: int
    blocks: list[BlockRecord] = field(default_factory=list)
    furniture_lines: int = 0
    furniture_texts: list[str] = field(default_factory=list)
    annotation_counts: dict[str, int] = field(default_factory=dict)
    annotation_spans_dropped: int = 0
    overlay_duplicate_pages: int = 0
    toc_pages: int = 0


def process_pdf(
    pdf_path: str,
    file_name: str,
    group: str,
    category: str,
    page_range: Optional[tuple[int, int]] = None,
) -> FileResult:
    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)

    if page_range:
        first_page = max(page_range[0], 1) - 1
        last_page = min(page_range[1], total_pages)
        page_indices = list(range(first_page, last_page))
    else:
        page_indices = list(range(total_pages))

    n_pages = len(page_indices)
    
    total_annot_counts = Counter()
    total_spans_dropped = 0
    
    all_lines: list[VisualLine] = []
    page_dims: dict[int, tuple[float, float]] = {}
    
    for pg_idx in page_indices:
        page = doc[pg_idx]
        page_num = pg_idx + 1
        w, h = page.rect.width, page.rect.height
        page_dims[pg_idx] = (w, h)
        
        spans, annots, dropped = extract_spans(page)
        for k, v in annots.items():
            total_annot_counts[k] += v
        total_spans_dropped += dropped
        
        _, lines = build_visual_lines(spans, pg_idx, page_num, w)
        all_lines.extend(lines)

    if page_dims:
        rep_width, rep_height = next(iter(page_dims.values()))
    else:
        rep_width, rep_height = 612, 792

    furniture_set = detect_furniture(all_lines, rep_height, n_pages)

    furn_counter: Counter = Counter()
    furn_global_indices: set[int] = set()
    for i, li in enumerate(all_lines):
        if (li.page_idx, i) in furniture_set:
            furn_counter[li.text.strip()] += 1
            furn_global_indices.add(i)

    clean_lines = [li for i, li in enumerate(all_lines) if i not in furn_global_indices]

    lines_by_page: dict[int, list[VisualLine]] = defaultdict(list)
    for li in clean_lines:
        lines_by_page[li.page_idx].append(li)
        
    # Beamer overlay duplicate detection
    # Page i is an overlay duplicate if its non-furniture text is a subset
    # of page i+1's text (Beamer adds content incrementally).
    overlay_dup_pages: set[int] = set()
    sorted_page_idx = list(page_indices)
    for k in range(len(sorted_page_idx) - 1):
        pg_a = sorted_page_idx[k]
        pg_b = sorted_page_idx[k + 1]
        lines_a = lines_by_page.get(pg_a, [])
        lines_b = lines_by_page.get(pg_b, [])
        texts_a = {l.text.strip() for l in lines_a if l.text.strip()}
        texts_b = {l.text.strip() for l in lines_b if l.text.strip()}
        if texts_a and texts_b:
            overlap = len(texts_a & texts_b)
            if overlap >= 0.8 * len(texts_a):
                overlay_dup_pages.add(pg_a)

    overlay_duplicate_count = len(overlay_dup_pages)
    valid_page_indices = [p for p in page_indices if p not in overlay_dup_pages]


    all_blocks: list[BlockRecord] = []
    toc_pages = 0
    prev_page_ends_abruptly = False

    for pg_idx in valid_page_indices:
        page_lines = lines_by_page.get(pg_idx, [])
        if not page_lines:
            prev_page_ends_abruptly = False
            continue

        w, h = page_dims[pg_idx]
        
        # Check TOC
        toc_entries = sum(1 for l in page_lines if is_toc_entry(l.text))
        is_toc = toc_entries >= 5
        if is_toc:
            toc_pages += 1

        line_heights = [l.bbox[3] - l.bbox[1] for l in page_lines if (l.bbox[3] - l.bbox[1]) > 0]
        median_lh = statistics.median(line_heights) if line_heights else 12.0
        font_sizes = [l.font_size for l in page_lines]
        median_font = statistics.median(font_sizes) if font_sizes else 10.0

        x0s = sorted(l.bbox[0] for l in page_lines)
        body_left = x0s[max(0, len(x0s) // 10)] if x0s else 0.0

        n_cols = 2 if any(l.column == 1 for l in page_lines) else 1
        body_font = page_body_font(page_lines)
        raw_blocks = group_lines_into_blocks(page_lines, w, h, n_cols, is_toc, body_font)
        raw_blocks = extend_algorithm_blocks(raw_blocks, median_lh, body_font)
        
        # Integrity check
        sum_chars_spans = sum(l.n_chars for l in page_lines)
        sum_chars_blocks = sum(sum(l.n_chars for l in rb.lines) for rb in raw_blocks)
        if sum_chars_spans != sum_chars_blocks:
            print(f"WARNING: Integrity check failed on page {pg_idx+1}: spans={sum_chars_spans}, blocks={sum_chars_blocks}", file=sys.stderr)

        prev_y1: Optional[float] = None
        for bi, rb in enumerate(raw_blocks):
            
            is_continuation = False
            if bi == 0 and prev_page_ends_abruptly:
                if rb.lines[0].text and rb.lines[0].text[0].islower():
                    is_continuation = True
            
            rec = compute_block_record(
                block=rb,
                block_index=bi,
                file_name=file_name,
                group=group,
                category=category,
                page_width=w,
                page_height=h,
                page_median_font_size=median_font,
                page_body_left=body_left,
                page_median_lh=median_lh,
                prev_block_y1=prev_y1,
                is_toc_page=is_toc,
                is_continuation=is_continuation,
                body_font=body_font,
            )
            all_blocks.append(rec)
            prev_y1 = max(l.bbox[3] for l in rb.lines)
            
        if raw_blocks:
            last_text = raw_blocks[-1].lines[-1].text.strip()
            prev_page_ends_abruptly = bool(last_text and last_text[-1] not in ".!?;")
        else:
            prev_page_ends_abruptly = False

    doc.close()

    return FileResult(
        file_name=file_name,
        group=group,
        category=category,
        pages_processed=n_pages,
        blocks=all_blocks,
        furniture_lines=len(furn_global_indices),
        furniture_texts=[t for t, _ in furn_counter.most_common(5)],
        annotation_counts=dict(total_annot_counts),
        annotation_spans_dropped=total_spans_dropped,
        overlay_duplicate_pages=overlay_duplicate_count,
        toc_pages=toc_pages
    )


# ======================================================================
# Overlay rendering
# ======================================================================

_LABEL_COLOURS: dict[Optional[str], tuple[int, int, int]] = {
    "definition": (0, 100, 200),
    "theorem":    (200, 60, 0),
    "proof":      (0, 160, 0),
    "example":    (180, 120, 0),
    "notation":   (128, 0, 128),
    "algorithm":  (0, 128, 128),
    "other":      (128, 128, 0),
    None:         (160, 160, 160),
}


def render_overlays(
    pdf_path: str,
    file_name: str,
    blocks: list[BlockRecord],
    out_dir: str,
    page_range: Optional[tuple[int, int]] = None,
) -> list[str]:
    if not blocks:
        return []

    doc = pymupdf.open(pdf_path)
    stem = Path(file_name).stem

    pages_with_blocks: dict[int, list[BlockRecord]] = defaultdict(list)
    for b in blocks:
        pages_with_blocks[b.page].append(b)

    if not pages_with_blocks:
        doc.close()
        return []

    sorted_pages = sorted(pages_with_blocks.keys())
    labelled_pages = [p for p in sorted_pages if any(b.weak_label for b in pages_with_blocks[p])]
    first_labelled = labelled_pages[0] if labelled_pages else sorted_pages[0]

    mid_page = sorted_pages[len(sorted_pages) // 2]
    most_blocks_page = max(sorted_pages, key=lambda p: len(pages_with_blocks[p]))

    selected = sorted(set([first_labelled, mid_page, most_blocks_page]))

    overlay_dir = os.path.join(out_dir, "overlays")
    os.makedirs(overlay_dir, exist_ok=True)

    paths: list[str] = []
    for page_num in selected:
        pg_idx = page_num - 1
        if pg_idx < 0 or pg_idx >= len(doc):
            continue
        page = doc[pg_idx]

        w = page.rect.width
        h = page.rect.height

        shape = page.new_shape()
        for b in pages_with_blocks.get(page_num, []):
            x0 = b.bbox["x0"] * w
            y0 = b.bbox["y0"] * h
            x1 = b.bbox["x1"] * w
            y1 = b.bbox["y1"] * h
            rect = pymupdf.Rect(x0, y0, x1, y1)

            colour = _LABEL_COLOURS.get(b.weak_label, (160, 160, 160))
            colour_f = tuple(c / 255.0 for c in colour)

            shape.draw_rect(rect)
            shape.finish(color=colour_f, width=1.5, fill=None, fill_opacity=0.15)

            label_str = f"{b.block_index}"
            if b.weak_label:
                label_str += f" {b.weak_label}"
            try:
                shape.insert_text(
                    pymupdf.Point(x0 + 2, y0 + 8),
                    label_str,
                    fontsize=7,
                    color=colour_f,
                )
            except Exception:
                pass

        shape.commit()
        pix = page.get_pixmap(dpi=100)

        out_path = os.path.join(overlay_dir, f"{stem}_p{page_num}.png")
        pix.save(out_path)
        paths.append(out_path)

    doc.close()
    return paths


# ======================================================================
# Report generation
# ======================================================================

def generate_report(results: list[FileResult], out_dir: str) -> str:
    rng = random.Random(42)
    lines: list[str] = ["# ML Data Pipeline — Block Extraction Report\n"]

    for res in results:
        lines.append(f"\n## {res.file_name}\n")
        lines.append(f"- **Pages processed**: {res.pages_processed}")
        n_blocks = len(res.blocks)
        bpp = round(n_blocks / max(res.pages_processed, 1), 1)
        lines.append(f"- **Total blocks**: {n_blocks} ({bpp} / page)")
        lines.append(f"- **Furniture lines removed**: {res.furniture_lines}")
        if res.furniture_texts:
            top_furn = ", ".join(f'`{t[:60]}`' for t in res.furniture_texts[:5])
            lines.append(f"- **Top furniture texts**: {top_furn}")
            
        lines.append(f"- **TOC pages**: {res.toc_pages}")
        lines.append(f"- **Overlay duplicate pages**: {res.overlay_duplicate_pages}")
        
        annot_info = ", ".join(f"{k}: {v}" for k, v in res.annotation_counts.items())
        lines.append(f"- **Annotation counts**: {annot_info if annot_info else 'None'}")
        lines.append(f"- **Annotation spans dropped**: {res.annotation_spans_dropped}")
        lines.append(f"- **has_user_annotations**: {bool(res.annotation_counts)}")

        label_counts: Counter = Counter()
        subtype_counts: Counter = Counter()
        n_missed = 0
        n_short = 0
        n_long = 0
        for b in res.blocks:
            label_counts[b.weak_label] += 1
            if b.weak_subtype:
                subtype_counts[b.weak_subtype] += 1
            if b.possible_missed_split:
                n_missed += 1
            if "very_short" in b.flags:
                n_short += 1
            if "very_long" in b.flags:
                n_long += 1

        lines.append(f"\n### Label distribution\n")
        lines.append("| weak_label | count |")
        lines.append("|---|---|")
        for lbl, cnt in sorted(label_counts.items(), key=lambda x: (x[0] is None, x[0])):
            lines.append(f"| {lbl} | {cnt} |")

        lines.append(f"\n### Subtype distribution\n")
        lines.append("| subtype | count |")
        lines.append("|---|---|")
        for st, cnt in sorted(subtype_counts.items()):
            lines.append(f"| {st} | {cnt} |")

        lines.append(f"\n- **possible_missed_split**: {n_missed}")
        lines.append(f"- **very_short (<15 chars)**: {n_short}")
        lines.append(f"- **very_long (>2000 chars)**: {n_long}")

        labelled = [b for b in res.blocks if b.weak_label is not None]
        unlabelled = [b for b in res.blocks if b.weak_label is None]

        lines.append(f"\n### Sample labelled blocks ({min(8, len(labelled))} of {len(labelled)})\n")
        sample_l = rng.sample(labelled, min(8, len(labelled)))
        for b in sample_l:
            lines.append(f"**Page {b.page}, block {b.block_index}** — "
                         f"`{b.weak_label}` / `{b.weak_subtype}` | "
                         f"evidence: {b.heading_evidence}")
            lines.append(f"> **text**: {b.text[:300]}{'…' if len(b.text) > 300 else ''}")
            lines.append(f"> **without heading**: {b.text_without_heading[:300]}{'…' if len(b.text_without_heading) > 300 else ''}\n")

        lines.append(f"\n### Sample unlabelled blocks ({min(8, len(unlabelled))} of {len(unlabelled)})\n")
        sample_u = rng.sample(unlabelled, min(8, len(unlabelled)))
        for b in sample_u:
            lines.append(f"**Page {b.page}, block {b.block_index}** — "
                         f"flags: {b.flags}")
            lines.append(f"> {b.text[:300]}{'…' if len(b.text) > 300 else ''}\n")

    lines.append("\n## Suspicious blocks\n")
    lines.append("Blocks with `possible_missed_split` or heading evidence = `[\"regex\"]` only.\n")
    found_suspicious = False
    for res in results:
        for b in res.blocks:
            is_suspicious = (
                b.possible_missed_split
                or (b.heading_evidence == ["regex"] and b.weak_label is not None)
            )
            if is_suspicious:
                found_suspicious = True
                reason = []
                if b.possible_missed_split:
                    reason.append("missed_split")
                if b.heading_evidence == ["regex"]:
                    reason.append("regex_only")
                lines.append(
                    f"- **{res.file_name}** p{b.page} b{b.block_index}: "
                    f"{', '.join(reason)} — `{b.text[:120]}`"
                )
    if not found_suspicious:
        lines.append("*None found.*\n")

    report_path = os.path.join(out_dir, "report_sample.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return report_path


# ======================================================================
# CLI
# ======================================================================

def parse_file_spec(spec: str) -> tuple[str, Optional[tuple[int, int]]]:
    if ":" in spec:
        m = re.search(r":(\d+)-(\d+)$", spec)
        if m:
            file_part = spec[:m.start()]
            return file_part, (int(m.group(1)), int(m.group(2)))
    return spec, None


def load_manifest(manifest_path: str) -> dict[str, dict]:
    manifest: dict[str, dict] = {}
    with open(manifest_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            fname = row["file"].strip()
            manifest[fname] = {
                "group": row.get("group", "").strip(),
                "category": row.get("category", "").strip(),
            }
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract text blocks from PDFs with layout features and weak labels."
    )
    parser.add_argument("--manifest", required=True, help="Path to manifest.csv")
    parser.add_argument("--pdf-dir", required=True, help="Directory containing PDFs")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--only", nargs="+", help="Only process these files (with optional :start-end page ranges)")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)

    file_specs: list[tuple[str, Optional[tuple[int, int]]]] = []
    if args.only:
        for spec in args.only:
            file_specs.append(parse_file_spec(spec))
    else:
        for fname in manifest:
            file_specs.append((fname, None))

    all_results: list[FileResult] = []
    all_blocks: list[BlockRecord] = []

    for file_name, page_range in file_specs:
        pdf_path = os.path.join(args.pdf_dir, file_name)
        if not os.path.exists(pdf_path):
            print(f"WARNING: file not found: {pdf_path}", file=sys.stderr)
            continue

        meta = manifest.get(file_name, {"group": "unknown", "category": "unknown"})
        print(f"Processing: {file_name} (pages: {page_range or 'all'}) ...")

        result = process_pdf(
            pdf_path=pdf_path,
            file_name=file_name,
            group=meta["group"],
            category=meta["category"],
            page_range=page_range,
        )
        all_results.append(result)
        all_blocks.extend(result.blocks)

        n_labelled = sum(1 for b in result.blocks if b.weak_label)
        print(f"  -> {len(result.blocks)} blocks, {n_labelled} labelled, "
              f"{result.furniture_lines} furniture lines removed")
              
        annot_info = ", ".join(f"{k}: {v}" for k, v in result.annotation_counts.items())
        print(f"  -> Annotations: {annot_info if annot_info else 'None'} ({result.annotation_spans_dropped} spans dropped)")
        if result.toc_pages > 0:
            print(f"  -> TOC pages: {result.toc_pages}")
        if result.overlay_duplicate_pages > 0:
            print(f"  -> Overlay duplicates: {result.overlay_duplicate_pages}")

        overlay_paths = render_overlays(
            pdf_path=pdf_path,
            file_name=file_name,
            blocks=result.blocks,
            out_dir=out_dir,
            page_range=page_range,
        )
        if overlay_paths:
            print(f"  -> Overlays: {', '.join(os.path.basename(p) for p in overlay_paths)}")

    jsonl_path = os.path.join(out_dir, "blocks_sample.jsonl")
    with open(jsonl_path, "w", encoding="utf-8") as f:
        for rec in all_blocks:
            d = asdict(rec)
            f.write(json.dumps(d, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"\nWrote {len(all_blocks)} blocks to {jsonl_path}")

    report_path = generate_report(all_results, out_dir)
    print(f"Wrote report to {report_path}")


if __name__ == "__main__":
    main()
