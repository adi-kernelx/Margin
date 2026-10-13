"""ML2.14: prose-definition sentences taken from LaTeX source, aligned to PDF blocks.

The classifier never saw a prose definition in training: its only definitions
were blocks headed "Definition 2.1." In LaTeX the author marks a defined term
with emphasis, e.g. "a graph is called \\emph{bipartite} if ...". A sentence is
taken as a prose-definition positive when, outside every theorem-like
environment (those are already headed blocks), it contains

  * an emphasis command (\\emph, \\textit, \\textbf, {\\em ...}, {\\it ...}), and
  * a defining cue in the same sentence ("is called", "we say", "is said to be",
    "we call", "define", "denote", "refer to as", "known as", "termed").

Each such sentence is aligned to an unheaded PDF block of the same paper by an
exact 6-word anchor (unique match only), and then to the PDF sentence inside
that block with the largest word overlap. Unmatched sentences are dropped and
counted, never guessed. Only training-source papers are used.
"""

import json
import re
from collections import Counter
from pathlib import Path

from ml.data.arxiv_corpus import ROOT, audit_selection
from ml.data.heading_rules import _SUBTYPE_TO_LABEL
from ml.eval.latex_audit import read_tex, tokens
from ml.models.sentences import split_sentences

EMPHASIS = re.compile(r"\\(?:emph|textit|textbf|textsl)\s*\{|\{\\(?:em|it|bf|sl)\b")
CUE = re.compile(r"\b(?:is|are) (?:called|said to be|termed|known as|referred to as)\b|\bwe (?:say|call)\b"
                 r"|\bcalled\b|\bdefine[sd]?\b|\bdenote[sd]?\b|\brefer(?:red)? to as\b|\bknown as\b", re.I)
ANCHOR = 6


def prose_outside_environments(text):
    """Remove comments and every theorem-like / proof environment body."""
    text = re.sub(r"(?<!\\)%[^\n]*", "", text)
    aliases = dict(_SUBTYPE_TO_LABEL)
    for name, title in re.findall(r"\\newtheorem\*?\s*\{([^}]+)\}\s*(?:\[[^]]*\]\s*)?\{([^}]+)\}", text):
        if title.strip().lower() in _SUBTYPE_TO_LABEL:
            aliases[name] = _SUBTYPE_TO_LABEL[title.strip().lower()]
    masked = text
    for name in sorted(aliases, key=len, reverse=True):
        pattern = re.compile(r"\\begin\s*\{" + re.escape(name) + r"\*?\}.*?\\end\s*\{" + re.escape(name) + r"\*?\}", re.S)
        masked = pattern.sub(" ", masked)
    # Display maths and figure/table floats are not prose.
    masked = re.sub(r"\\begin\s*\{(equation|align|gather|multline|figure|table|algorithm)\*?\}.*?\\end\s*\{\1\*?\}",
                    " ", masked, flags=re.S)
    masked = re.sub(r"\\\[.*?\\\]|\$\$.*?\$\$", " ", masked, flags=re.S)
    return masked


def latex_sentences(text):
    """Sentences that carry emphasis and a defining cue."""
    body = prose_outside_environments(text)
    result = []
    for paragraph in re.split(r"\n\s*\n", body):
        for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z\\])", " ".join(paragraph.split())):
            if EMPHASIS.search(sentence) and CUE.search(re.sub(r"\\[A-Za-z]+", " ", sentence)):
                words = tokens(sentence, latex=True)
                if len(words) >= ANCHOR:
                    result.append(words)
    return result


def align(sentences, blocks):
    """Map LaTeX sentences to (block, PDF sentence) pairs; return decisions and counts."""
    index = {}
    unheaded = [b for b in blocks if not b.get("weak_label")]
    for position, block in enumerate(unheaded):
        words = tokens(block["text"])
        for start in range(max(0, len(words) - ANCHOR + 1)):
            index.setdefault(tuple(words[start:start + ANCHOR]), set()).add(position)
    counts, decisions, seen = Counter(), [], set()
    for words in sentences:
        hits = set()
        for start in range(max(0, len(words) - ANCHOR + 1)):
            hits |= index.get(tuple(words[start:start + ANCHOR]), set())
        if len(hits) != 1:
            counts["unmatched" if not hits else "ambiguous"] += 1
            continue
        block = unheaded[hits.pop()]
        target = set(words)
        pdf_sentences = split_sentences(block["text"])
        best = max(range(len(pdf_sentences)), key=lambda i: len(target & set(tokens(pdf_sentences[i]))))
        key = (block["block_id"], best)
        if key in seen:
            counts["duplicate"] += 1
            continue
        seen.add(key)
        counts["aligned"] += 1
        decisions.append({"block_id": block["block_id"], "group": block["group"], "sentence_index": best})
    return decisions, counts


def main():
    papers = audit_selection(json.loads((ROOT / "manifest.json").read_text(encoding="utf-8")), 20)
    test_groups = set(json.loads(Path("ml/splits.json").read_text(encoding="utf-8"))["test_groups"])
    total, rows = Counter(), []
    for paper in papers:
        if "arxiv-" + paper["base_id"] in test_groups:
            raise ValueError("A LaTeX source belongs to a frozen test group")
        blocks = [json.loads(line) for line in (ROOT / (paper["id"] + ".blocks.jsonl")).read_text(encoding="utf-8").splitlines()]
        sentences = [s for text in read_tex((ROOT / (paper["id"] + ".source")).read_bytes()) for s in latex_sentences(text)]
        decisions, counts = align(sentences, blocks)
        total.update(counts)
        total["latex_sentences"] += len(sentences)
        rows.extend(decisions)
        print(paper["id"], len(sentences), "sentences ->", counts.get("aligned", 0), "aligned", flush=True)
    out = Path("ml/out/ml214/latex_positives.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    summary = {"papers": len(papers), **dict(total), "positive_sentences": len(rows),
               "positive_groups": len({row["group"] for row in rows}), "test_evaluated": False}
    Path("ml/results/latex_definition_positives.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
