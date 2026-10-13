"""ML2.14: words the author emphasised inside a block (italic/bold text, not maths).

Prose definitions mark the defined word typographically: "a graph is called
*bipartite* if ...". Block-level italic ratios cannot see this because maths is
italic too (ML2.14: italics in 83% of definitions but also 60% of other blocks).

An emphasised run is a maximal run of spans in reading order that
  * use a text font, not a maths font (CMMI, CMSY, LMMathItalic, MSBM, ...);
  * differ in style (bold, italic) from the block's dominant text style, so the
    upright \\emph inside an italic theorem body counts and italic body text
    does not;
  * contain a word of at least three letters (maths variables are one letter).

The function works from page spans and an existing block's bounding box, so it
annotates already-extracted blocks without re-extraction: frozen test block IDs
and boundaries stay exactly as labelled.
"""

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

MATH_FONT = re.compile(r"CMMI|CMSY|CMEX|CMBSY|MSAM|MSBM|EUF|EUS|RSFS|Math|Symbol|STIXGeneral-Italic|cmmi|cmsy", re.I)
WORD = re.compile(r"[A-Za-z]{3,}")


def _style(span):
    flags = span.get("flags", 0)
    return bool(flags & 16) or "bold" in span["font"].lower(), bool(flags & 2) or bool(
        re.search(r"ital|oblique|-it\b|ti\d", span["font"], re.I))


def emphasised_terms(spans, heading_text=None):
    """Return emphasised word runs from spans already in reading order.

    `spans` are PyMuPDF span dicts with `text`, `font` and `flags`. Runs inside
    the block's heading text ("Definition 2.1") are not emphasis of the body.
    """
    text_spans = [s for s in spans if s.get("text", "").strip() and not MATH_FONT.search(s.get("font", ""))]
    if not text_spans:
        return []
    weight = Counter()
    for span in text_spans:
        weight[_style(span)] += len(span["text"].strip())
    body = weight.most_common(1)[0][0]

    def emphasised(span):
        if MATH_FONT.search(span.get("font", "")):
            return False
        return _style(span) != body

    runs, current = [], []
    for span in spans:
        if not span.get("text", "").strip():
            continue                      # spacing spans neither extend nor break a run
        if emphasised(span):
            current.append(span["text"])
        elif current:                     # body text or maths closes the run
            runs.append(" ".join(current))
            current = []
    if current:
        runs.append(" ".join(current))
    heading = (heading_text or "").lower()
    terms = []
    for run in runs:
        term = " ".join(run.split()).strip(" ,.;:()")
        if WORD.search(term) and term.lower() not in heading and len(term) <= 80:
            terms.append(term)
    return terms


def annotate(pdf_path, blocks):
    """Map block_id -> emphasised terms, assigning spans by centre point to block bboxes."""
    import pymupdf
    by_page = defaultdict(list)
    for block in blocks:
        by_page[block["page"]].append(block)
    result = {block["block_id"]: [] for block in blocks}
    with pymupdf.open(pdf_path) as document:
        for number, page_blocks in by_page.items():
            page = document[number - 1]
            width, height = page.rect.width, page.rect.height
            assigned = defaultdict(list)
            for raw in page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)["blocks"]:
                for line in raw.get("lines", []):
                    if abs(line.get("dir", (1.0, 0.0))[1]) > 0.1:
                        continue
                    for span in line["spans"]:
                        x = (span["bbox"][0] + span["bbox"][2]) / 2 / width
                        y = (span["bbox"][1] + span["bbox"][3]) / 2 / height
                        for block in page_blocks:
                            box = block["bbox"]
                            if box["x0"] - 0.005 <= x <= box["x1"] + 0.005 and box["y0"] - 0.005 <= y <= box["y1"] + 0.005:
                                assigned[block["block_id"]].append(span)
                                break
            for block in page_blocks:
                result[block["block_id"]] = emphasised_terms(assigned[block["block_id"]], block.get("heading_text"))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--blocks", type=Path, nargs="+", required=True)
    parser.add_argument("--pdf-dirs", type=Path, nargs="+", default=[Path("Test PDFs"), Path("ml/out/arxiv_expansion")])
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    by_file = defaultdict(list)
    for path in args.blocks:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                block = json.loads(line)
                by_file[block["file"]].append(block)
    terms = {}
    for index, (name, blocks) in enumerate(sorted(by_file.items())):
        pdf = next((directory / name for directory in args.pdf_dirs if (directory / name).exists()), None)
        if pdf is None:
            raise FileNotFoundError(name)
        terms.update(annotate(pdf, blocks))
        if index % 25 == 0:
            print(f"{index + 1}/{len(by_file)} files", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(json.dumps({"block_id": key, "emphasis": value}, ensure_ascii=False) + "\n"
                                for key, value in terms.items()), encoding="utf-8")
    print(f"{len(terms)} blocks, {sum(bool(v) for v in terms.values())} with emphasis")


if __name__ == "__main__":
    main()
