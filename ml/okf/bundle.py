"""ML3: write an Open Knowledge Format (OKF v0.2) bundle for one PDF.

Concepts come from the frozen pipeline (ml/okf/pipeline.py):
  * headed definition, theorem-like (theorem, lemma, proposition, corollary,
    claim, conjecture), algorithm and notation blocks -> one concept each;
  * unheaded blocks the detector marks as containing a definition -> one
    Definition concept, titled by the defined term;
  * proofs are not concepts; a theorem records the page of the proof that follows it.

Every concept file has OKF frontmatter: `type` (required), `title`,
`description`, `resource` (margin://doc/<fingerprint>/page/<n>#bbox=...),
`tags`, `sources`, `generated` {by, at} and `status: draft`, plus a `margin`
extension key with page, block id, method and confidence. Links are plain
markdown links under "# Uses": references such as "by Theorem 3.4" and mentions
of defined terms. The root index.md declares okf_version 0.2; log.md records the
creation. Nothing is written as verified: only a human Verify action does that.

    python -m ml.okf.bundle --pdf "Test PDFs/some.pdf" --out ml/out/bundles/some
"""

import argparse
import hashlib
import re
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

from ml.okf.pipeline import VERSION, FrozenPipeline

PRODUCER = f"margin-okf/{VERSION}"
# heading subtype (ml/data/heading_rules.py) -> OKF type value
TYPE_OF_SUBTYPE = {
    "definition": "Definition", "defn": "Definition", "def": "Definition",
    "notation": "Notation", "algorithm": "Algorithm",
    "theorem": "Theorem", "thm": "Theorem", "lemma": "Lemma", "proposition": "Proposition", "prop": "Proposition",
    "corollary": "Corollary", "cor": "Corollary", "claim": "Claim", "conjecture": "Conjecture",
    "fact": "Fact", "observation": "Observation",
}
FOLDER_OF_TYPE = {"Definition": "definitions", "Notation": "notation", "Algorithm": "algorithms"}
RESULT_TYPES = {"Theorem", "Lemma", "Proposition", "Corollary", "Claim", "Conjecture", "Fact", "Observation"}
REFERENCE = re.compile(r"\b(Theorem|Thm\.?|Lemma|Proposition|Prop\.?|Corollary|Cor\.?|Definition|Def\.?|"
                       r"Algorithm|Alg\.?|Claim|Conjecture|Notation)s?\s+([A-Z]?\.?\d+(?:\.\d+)*[a-z]?)", re.I)
REFERENCE_KIND = {"thm": "theorem", "prop": "proposition", "cor": "corollary", "def": "definition", "alg": "algorithm"}
TERM_PATTERNS = [
    re.compile(r"\b(?:is|are) (?:called|said to be|termed|known as|referred to as) (?:an? |the )?"
               r"[“\"']?([A-Za-z][\w\-’' ]{1,40}?)[”\"']?(?=\s*(?:[,.;:(•▪–]|if\b|when\b|whenever\b|$))", re.I),
    # "we say that X is (a) TERM if ..."
    re.compile(r"\b[Ww]e say (?:that )?.{0,80}?\b(?:is|are) (?:an? |the )?((?:[a-z][a-z\-]+ ){0,3}[a-z][a-z\-]+)"
               r"(?= of\b| if\b| when\b| against\b|[,.;(]|$)"),
    # "we call [object] an TERM of/if ..." - the term follows the article after the object
    re.compile(r"\b[Ww]e call\b.{0,60}?\b(?:an?|the) ((?:[a-z][a-z\-]+ ){0,2}[a-z][a-z\-]+)"
               r"(?= of\b| if\b| for\b| at\b| in\b| on\b| with\b|[,.;]|$)"),
    re.compile(r"\b(?:we )?refer to\b.{1,60}?\bas (?:an? |the )?((?:[a-z][a-z\-]+ ){0,3}[a-z][a-z\-]+)(?=\s*[,.;]|\s*$)", re.I),
    re.compile(r"\b(?:we|let us) define (?:the |an? )?([A-Za-z][\w\- ]{1,40}?) (?:as|by|to be|of)\b", re.I),
    re.compile(r"\b(?:define|denote by)\s+(?:the |an? )?((?:[a-z][a-z\-]+ ){0,3}[a-z][a-z\-]+)"),
    re.compile(r"^(?:the |an? )?([A-Za-z][\w\- ]{1,40}?)(?: \([^)]{1,20}\))? (?:is|are) defined\b", re.I),
]
# "Term: gloss" on slides and in lists. Accepted only when the gloss is definitional
# (a cue or "is/are/refers"), not a question, and the term is not a generic heading.
COLON_TERM = re.compile(r"^([A-Z][\w\-’' ]{1,40}?)\s*(?:\([^)]{1,20}\)\s*)*(?:\(definition\))?\s*:\s+(.*)", re.I)
# Last resort: the subject of "A TERM is a ..." ("A polytree is a directed graph ...").
SUBJECT_TERM = re.compile(r"^(?:an?|the) ((?:[A-Za-z][\w\-]+ ){0,3}[A-Za-z][\w\-]+)(?: \([^)]{1,20}\))? "
                          r"(?:is|are) (?:an?|the)\b", re.I)
GENERIC_TERMS = {"this", "that", "it", "they", "the", "set", "function", "following", "above", "below", "case",
                 "us", "following events", "following conditions", "following properties", "notation",
                 "definition", "theorem", "algorithm", "theory", "conclusion", "solution", "example", "proof", "note",
                 "idea", "goal", "problem", "answer", "summary", "introduction", "overview", "motivation",
                 "limitation", "intuition", "method", "approach", "result", "results", "main results", "remark",
                 "point", "key point", "hint", "question", "exercise", "exercises"}
# List and section prefixes on slides and in papers: "a) ", "(ii) ", "2.1 ", "A.1 ", "IV. ", "§ ", "• ".
ENUMERATOR = re.compile(r"^(?:[§•▪●◦\-–]\s*|(?:[A-Za-z][.)]|\((?:[ivx]+|\d+|[a-z])\)|\d+(?:\.\d+)*[.)]?|[IVX]+[.)]|"
                        r"[A-Z]\.\d+(?:\.\d+)*[.)]?)"
                        r"\s+(?=[A-Za-z]))+")


def pdf_fingerprint(path):
    """Same identity as PDF.js `fingerprints[0]`: first trailer /ID in hex, else MD5 of the first 1024 bytes."""
    import pymupdf
    with pymupdf.open(path) as document:
        kind, value = document.xref_get_key(-1, "ID")
    match = re.match(r"\[\s*<([0-9A-Fa-f]+)>", value or "") if kind == "array" else None
    if match and set(match.group(1)) != {"0"}:
        return match.group(1).lower()
    return hashlib.md5(Path(path).read_bytes()[:1024]).hexdigest()


def slug(text, limit=60):
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    value = value[:limit].rstrip("-") or "concept"
    # index.md and log.md are reserved by OKF; a concept called "index" must not take that name.
    return f"{value}-concept" if value in ("index", "log") else value


CUE = re.compile(r"\b(?:called|termed|known as|referred to as|we say|we call|call|said to be|"
                 r"define[sd]?|denoted? by|denote[sd]?)\b", re.I)
CITATION = re.compile(r"\bdoi\b|arXiv:|\bet al\.|\bpp\.|\b[Vv]ol\.|\bProceedings\b|\bJournal\b|\(\d{4}\)")


# A defined term is a noun phrase: discourse and verb words mean the pattern
# caught a clause ("Then:", "We observe that", "problem can be written as follows").
NOT_IN_TERM = {"is", "are", "was", "can", "be", "will", "we", "then", "for", "observe", "follows", "written",
               "that", "which", "where", "if", "let", "hence", "thus", "so", "now", "note", "following", "given",
               "consider", "here", "there", "this", "these", "such", "have", "has", "using", "see",
               "in", "next", "slide", "slides", "below", "above", "later"}


def _clean(term):
    term = ENUMERATOR.sub("", term.strip(" ,.;:“”\"'"))
    term = re.sub(r"^(?:the|a|an)\s+", "", term, flags=re.I)
    term = re.sub(r"\s+(?:of|the|a|an|is|are)$", "", term, flags=re.I)
    term = re.sub(r"\s*\([^)]*$", "", term).strip()      # "e-CNY (China" -> "e-CNY"
    if len(term) < 2 or term.lower() in GENERIC_TERMS or not re.search(r"[A-Za-z]{3}", term):
        return None
    if {word.lower() for word in re.findall(r"[A-Za-z]+", term)} & NOT_IN_TERM:
        return None
    # Hyperlinked cross-references are styled like emphasis ("Section 5", "Theorem 2.1").
    if re.match(r"(?:section|sec\.|theorem|lemma|proposition|corollary|definition|figure|fig\.|table|"
                r"equation|eq\.|appendix|chapter|algorithm|remark|example)\s*[A-Z]?\.?\d", term, re.I):
        return None
    return term


def defined_term(sentence, emphasis_terms):
    """Best guess at the term a defining sentence introduces, or None.

    1. an emphasised term placed as a defined term: near a defining cue ("we
       call a tree t an *agreement subtree*", "a *penalty function* α is
       defined by"), or as the subject of "TERM is a/the/defined ..." at the
       start of the sentence. Emphasis alone is not enough: slides emphasise
       names, warnings and headings that define nothing;
    2. cue patterns ("is called X", "we call the X", "define the X", "X is defined");
    3. "Term: gloss" with a definitional gloss, then the subject of "A TERM is a ...".
    """
    sentence = ENUMERATOR.sub("", sentence.strip())
    if re.match(r"definition\s*:\s*", sentence, re.I):
        # "Definition: A Naive Bayes classifier is ..." names its subject
        sentence = re.sub(r"^definition\s*:\s*", "", sentence, flags=re.I)
        subject = SUBJECT_TERM.match(sentence)
        if subject and _clean(subject.group(1)):
            return _clean(subject.group(1))
    lowered = sentence.lower()
    cues = list(CUE.finditer(sentence))
    placed = []
    for term in emphasis_terms:
        if not 3 <= len(term) <= 60 or not _clean(term):
            continue
        at = lowered.find(term.lower())
        if at < 0:
            continue
        end = at + len(term)
        near_cue = any(c.start() - 30 <= at and at <= c.end() + 80 for c in cues)
        # "A *fixed point* of a function is ...": the subject, at most three words before is/are
        subject = at <= 4 and re.match(r"\s*(?:\S{1,12}\s+){0,3}(?:\([^)]{1,20}\)\s+)?(?:is|are)\b", sentence[end:])
        # "A graph is *viscous* if ...": a defined adjective between is/are and the condition
        predicate = (re.search(r"\b(?:is|are|be)\s+(?:an?\s+|the\s+)?$", sentence[:at])
                     and re.match(r"\s*(?:if|iff|when|whenever|provided)\b", sentence[end:]))
        if near_cue or subject or predicate:
            placed.append((0 if any(c.end() <= at for c in cues) else 1, at, term))
    if placed:
        return _clean(min(placed)[2])
    for pattern in TERM_PATTERNS:
        match = pattern.search(sentence)
        if match and _clean(match.group(1)):
            return _clean(match.group(1))
    colon = COLON_TERM.match(sentence)
    if colon and "?" not in colon.group(2) and (CUE.search(colon.group(2))
                                                 or re.search(r"\b(?:is|are|refers? to|means)\b", colon.group(2))):
        if _clean(colon.group(1)):
            return _clean(colon.group(1))
    subject = SUBJECT_TERM.match(sentence)
    if subject and _clean(subject.group(1)):
        return _clean(subject.group(1))
    return None


SYMBOL_PATTERNS = [
    re.compile(r"\blet (?!us\b)([^\s,]{1,12}) (?:denote|be)\b", re.I),
    re.compile(r"\bdenote (?:it )?by ([^\s,]{1,12})", re.I),
    re.compile(r"\bdenoted (?:as|by) [‘'“\"]?([^\s,‘'’“”\"]{1,12})", re.I),
    re.compile(r"(?:^|\bwhere |, )([^\s,]{1,6}(?: \( [^)]{1,15} \))?) denotes\b"),
    re.compile(r"\b(?:function|matrix|map|set|operator|vector|quantity) ([^\s,]{1,6}(?: \( [^)]{1,15} \))?) "
               r"(?:is|are) (?:defined|given) (?:as|by)\b", re.I),
    re.compile(r"\bdefine (?:the following \w+|the \w+|an? \w+)\s*:?\s*([^\s,]{1,6}(?: \( [^)]{1,15} \))?) (?:=|:=|≜)"),
]


def defined_symbol(sentence):
    """Symbol introduced by "let X denote", "denote by X", "denoted as 'X'", "where X denotes", or None."""
    for pattern in SYMBOL_PATTERNS:
        match = pattern.search(sentence)
        if match:
            return re.sub(r" ?([()]) ?", r"\1", match.group(1))
    return None


def headed_definition_term(body, emphasis_terms):
    """Defined term of a headed definition: its earliest emphasised term, else a cue pattern."""
    from ml.models.sentences import split_sentences
    lowered = body.lower()
    present = [(lowered.find(t.lower()), t) for t in emphasis_terms
               if 3 <= len(t) <= 60 and t.lower() in lowered and _clean(t)]
    if present:
        return _clean(min(present)[1])
    for sentence in split_sentences(body)[:4]:
        if CUE.search(sentence):
            term = defined_term(sentence, emphasis_terms)
            if term:
                return term
    return None


def _bbox_fragment(bbox):
    return "bbox=" + ",".join(f"{bbox[k]:.4f}" for k in ("x0", "y0", "x1", "y1"))


def _first_sentence(text, limit=200):
    from ml.models.sentences import split_sentences
    sentences = split_sentences(text)
    first = sentences[0] if sentences else text
    return first if len(first) <= limit else first[:limit - 1].rstrip() + "…"


def statement_gist(body, words=8):
    """Short name for an unnumbered, unnamed result or definition.

    The defined acronym of "ACQ holds at x* if ...", else the conclusion after
    "Then", else the opening words.
    """
    body = " ".join(body.split())
    if not body:
        return None
    acronym = re.match(r"(?:the |an? )?([A-Z][A-Za-z\-]*[A-Z][A-Za-z\-]*s?)\s+(?:holds|is|are|requires|ensures|means)\b",
                       body)
    if acronym:
        return acronym.group(1)
    then = re.search(r"\bThen,?\s+(.+?)(?:\.\s|\.$|$)", body)
    text = then.group(1) if then else re.split(r"(?<=[.;:])\s", body)[0]
    tokens = text.split()
    return " ".join(tokens[:words]).rstrip(".,;:") + ("…" if len(tokens) > words else "")


def build_concepts(blocks, decisions, emphasis, file_name, fingerprint, now):
    """Return concept dicts (path, frontmatter, body parts) for one document."""
    by_id = {block["block_id"]: block for block in blocks}
    concepts, used_paths, last_result = [], set(), None
    # Terms a headed definition names: a prose sentence that announces the same term
    # ("Formally, we define a penalty function in next slide") is not a second concept.
    headed_terms = [_headed_term(block, emphasis) for block in blocks
                    if (block.get("weak_subtype") or block.get("weak_label") or "").lower() in ("definition", "defn", "def")]
    seen_terms = {term.lower() for term in headed_terms if term}
    seen_symbols = set()
    for decision in decisions:
        block = by_id[decision.block_id]
        if decision.method == "heading":
            subtype = (block.get("weak_subtype") or block.get("weak_label") or "").lower()
            okf_type = TYPE_OF_SUBTYPE.get(subtype)
            if decision.role == "proof" and last_result is not None:
                last_result["proof_pages"].append(block["page"])
                continue
            if okf_type is None:
                continue
            heading = (block.get("heading_text") or okf_type).strip().rstrip(".:")
            body = (block.get("text_without_heading") or "").strip()
            name = _heading_name(block)
            if not name and okf_type in ("Definition", "Notation"):
                name = headed_definition_term(body, emphasis.get(block["block_id"], []))
            term = name if okf_type == "Definition" else None
            if not name and not block.get("heading_number"):
                name = statement_gist(body)      # a bare "Theorem" would not tell results apart
            name = name.strip() if name else None
            title = heading if not name or name in heading else f"{heading} ({name})"
            key = (REFERENCE_KIND.get(subtype, subtype), (block.get("heading_number") or "").lower())
            concept = _concept(okf_type, title, body, None, 1.0, "heading", block, key, used_paths,
                               file_name, fingerprint, now, f"{okf_type} {block.get('heading_number') or title}")
            concept["term"] = term
            concepts.append(concept)
            last_result = concept if okf_type in RESULT_TYPES else None
        elif decision.method == "detector":
            last_result = None
            # One concept per defining sentence (a slide may define two terms), at most three.
            for sentence, score in (decision.sentences or ((decision.sentence, decision.score),))[:MAX_PER_BLOCK]:
                # Bibliography entries are not definitions, whatever their wording.
                if CITATION.search(block["text"]) and not CUE.search(sentence):
                    continue
                term = defined_term(sentence, emphasis.get(block["block_id"], []))
                # No nameable term: the sentence introduces a symbol, so it is notation.
                if term:
                    okf_type, title = "Definition", term
                else:
                    okf_type, title = "Notation", defined_symbol(sentence)
                # Neither a term nor a symbol: the concept could not be found by name, and on
                # the ML3.2 development sample about half of these were not definitions at all.
                if not title:
                    continue
                # A term defined earlier and mentioned again later keeps its first occurrence.
                if term and term.lower() in seen_terms:
                    continue
                if term:
                    seen_terms.add(term.lower())
                elif title in seen_symbols:   # the same symbol restated ("denoted as 'cbRt'" twice)
                    continue
                else:
                    seen_symbols.add(title)
                concept = _concept(okf_type, title, block["text"].strip(), sentence, score, "detector",
                                   block, None, used_paths, file_name, fingerprint, now, title)
                concept["term"] = term
                concepts.append(concept)
    return concepts


MAX_PER_BLOCK = 3


def _heading_name(block):
    """The parenthesised name of a heading ("Definition (penalty function)"), unless it is a citation."""
    name = block.get("heading_name")
    if not name:
        match = re.search(r"\(([^()]{2,60})\)\s*$", (block.get("heading_text") or "").strip().rstrip(".:"))
        name = match.group(1) if match else None
    if name and (re.match(r"\s*(?:see|cf\.?)\b", name, re.I) or "[" in name):
        return None              # "(see e.g. [24])" is a citation, not a name
    return name.strip() if name else None


def _headed_term(block, emphasis):
    body = (block.get("text_without_heading") or "").strip()
    return _heading_name(block) or headed_definition_term(body, emphasis.get(block["block_id"], []))


def _concept(okf_type, title, body, sentence, score, method, block, key, used_paths, file_name, fingerprint, now,
             stem_text):
    folder = FOLDER_OF_TYPE.get(okf_type, "results")
    stem = slug(stem_text)
    path, n = f"{folder}/{stem}.md", 2
    while path in used_paths:
        path, n = f"{folder}/{stem}-{n}.md", n + 1
    used_paths.add(path)
    frontmatter = {
        "type": okf_type, "title": title, "description": _first_sentence(sentence or body or title),
        "resource": f"margin://doc/{fingerprint}/page/{block['page']}#{_bbox_fragment(block['bbox'])}",
        "tags": sorted({okf_type.lower(), "prose-definition" if method == "detector" else "headed"}),
        "sources": [{"id": "pdf", "resource": f"margin://doc/{fingerprint}", "title": file_name}],
        "generated": {"by": PRODUCER, "at": now},
        "status": "draft",
        "margin": {"page": block["page"], "block_id": block["block_id"], "method": method,
                   "confidence": round(float(score), 3)},
    }
    return {"path": path, "frontmatter": frontmatter, "body": body, "sentence": sentence,
            "key": key, "title": title, "proof_pages": [], "uses": []}


def link_concepts(concepts, max_links=12):
    """Fill `uses` with (target path, title) from numbered references and defined-term mentions."""
    by_key = {c["key"]: c for c in concepts if c["key"] and c["key"][1]}
    # Term mentions link only for specific terms: several words, or one word of 7+
    # letters ("size" or "event" would link everything). Fallback titles never link.
    def specific(term):
        words = term.split()
        return term.lower() not in GENERIC_TERMS and len(words) <= 6 and (len(words) >= 2 or len(term) >= 7)
    # A headed definition links by its name ("Definition 2.1 (plane tree)" by "plane tree").
    terms = [(c, re.compile(r"\b" + re.escape(c["term"]) + r"\b", re.I)) for c in concepts
             if c.get("term") and specific(c["term"])]
    for concept in concepts:
        targets = []
        for kind, number in REFERENCE.findall(concept["body"]):
            kind = REFERENCE_KIND.get(kind.lower().rstrip("."), kind.lower())
            target = by_key.get((kind, number.lower()))
            if target is not None and target is not concept and target not in targets:
                targets.append(target)
        # A mention inside a longer defined term ("level set" in "lower level set") is that term's.
        spans = [(m.start(), m.end(), target) for target, pattern in terms for m in pattern.finditer(concept["body"])]
        block = concept["frontmatter"]["margin"]["block_id"]
        for start, end, target in sorted(spans, key=lambda s: s[0]):
            if any(s <= start and end <= e and (e - s) > (end - start) for s, e, _ in spans):
                continue
            # concepts from the same block share its text, so a mention there is not a use
            if target["frontmatter"]["margin"]["block_id"] != block and target not in targets:
                targets.append(target)
        concept["uses"] = [(t["path"], t["title"]) for t in targets[:max_links]]


def render(concept):
    front = yaml.safe_dump(concept["frontmatter"], sort_keys=False, allow_unicode=True, width=1000)
    parts = [f"---\n{front}---\n"]
    if concept["sentence"]:
        parts.append(f"> {concept['sentence']}\n")
    parts.append(concept["body"] + "\n")
    if concept["proof_pages"]:
        pages = ", ".join(str(p) for p in sorted(set(concept["proof_pages"])))
        parts.append(f"\n# Proof\n\nProof on page {pages} of the source document.\n")
    if concept["uses"]:
        parts.append("\n# Uses\n\n" + "".join(f"- [{title}](/{path})\n" for path, title in concept["uses"]))
    return "\n".join(parts)


def render_index(concepts, file_name):
    sections = [("Definitions", {"Definition"}), ("Notation", {"Notation"}),
                ("Results", RESULT_TYPES), ("Algorithms", {"Algorithm"})]
    parts = ['---\nokf_version: "0.2"\n---\n', f"Knowledge extracted from {file_name}.\n"]
    for heading, types in sections:
        entries = [c for c in concepts if c["frontmatter"]["type"] in types]
        if entries:
            parts.append(f"\n# {heading}\n\n" + "".join(
                f"- [{c['title']}](/{c['path']}) — {c['frontmatter']['description']}\n" for c in entries))
    return "".join(parts)


def bundle_files(pdf_path, pipeline=None, category="paper", file_name=None):
    """Extract and classify one PDF; return ({bundle path: text}, summary) without touching disk."""
    from ml.data.emphasis import annotate
    from ml.data.extract_blocks import process_pdf
    pdf_path = Path(pdf_path)
    file_name = file_name or pdf_path.name
    pipeline = pipeline or FrozenPipeline.load()
    blocks = [asdict(b) for b in process_pdf(str(pdf_path), file_name, "user", category).blocks]
    emphasis = annotate(pdf_path, blocks)
    decisions = pipeline.classify(blocks, emphasis)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fingerprint = pdf_fingerprint(pdf_path)
    concepts = build_concepts(blocks, decisions, emphasis, file_name, fingerprint, now)
    link_concepts(concepts)
    files = {concept["path"]: render(concept) for concept in concepts}
    if concepts:     # index.md is optional; an empty one would not list any entries
        files["index.md"] = render_index(concepts, file_name)
    files["log.md"] = (f"# {now[:10]}\n\n**Creation** {len(concepts)} draft concepts generated by {PRODUCER} from "
                       f"{file_name} ({len(blocks)} blocks).\n")
    counts = {}
    for concept in concepts:
        counts[concept["frontmatter"]["type"]] = counts.get(concept["frontmatter"]["type"], 0) + 1
    summary = {"fingerprint": fingerprint, "blocks": len(blocks), "concepts": len(concepts), "types": counts,
               "links": sum(len(c["uses"]) for c in concepts)}
    return files, summary


def write_bundle(pdf_path, out_dir, pipeline=None, category="paper"):
    """Extract, classify and write one bundle; return a summary dict."""
    files, summary = bundle_files(pdf_path, pipeline, category)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for path, text in files.items():
        target = out_dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--category", default="paper",
                        help="paper, textbook, slides, notes, ... (a classifier feature)")
    args = parser.parse_args()
    print(write_bundle(args.pdf, args.out, category=args.category))


if __name__ == "__main__":
    main()
