"""Experimental compact evidence windows; uses query/candidates only."""

import math
import re
import unicodedata

from ml.retrieval.context_packing import SEPARATOR, STOP

TASK_WORDS = frozenset("distinguish distinguishes differ differs difference restrictions restriction denotes denote satisfy satisfies described viewing shown following".split())
QUALIFIER = re.compile(r"\b(if|unless|except|however|but|only|not|necessary|sufficient|where|these|therefore|called|defined|means)\b", re.I)


def terms(text):
    words = re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", text).casefold())
    result = set()
    for word in words:
        if word in STOP or word in TASK_WORDS:
            continue
        if len(word) > 4 and word.endswith("ies"):
            word = word[:-3] + "y"
        elif len(word) > 4 and word.endswith(("sses", "ches", "shes", "xes", "zes")):
            word = word[:-2]
        elif len(word) > 4 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        if len(word) > 1 or word.isdigit() or any(ord(c) > 127 for c in word):
            result.add(word)
    return result


def normalized(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def sentences(context):
    text = context.get("text", "").strip()
    title = context.get("title", "").strip()
    # Collapse repeated assembler prefixes; keep the last ambiguous title so
    # a natural sentence such as "Marker is ..." retains its subject.
    while title and text.casefold().startswith((title + " " + title + " ").casefold()):
        text = text[len(title):].lstrip()
    pieces = re.split(r"(?<=[.!?])\s+(?=[A-Z\u0080-\uffff])|\n\s*\n|\s*•\s*", text)
    seen, output = set(), []
    for piece in pieces:
        piece = piece.strip()
        signature = normalized(piece)
        if piece and signature not in seen and not re.search(r"[A-Za-z]{3,}…", piece):
            seen.add(signature)
            output.append(piece)
    return output


def select_contexts(question, contexts, *, byte_budget=4000, max_sources=4, window_bytes=1400):
    """Prefer queried concept anchors and complementary, bounded evidence windows.

    At most three adjacent units per source, without splitting sentences.
    Neighbor windows fit window_bytes; an atomic longer sentence may use the
    total budget so a hard per-window cut never removes half a condition.
    Oversize windows are shortened by removing whole neighbors; a sentence
    larger than the total budget is ineligible. No gold, page labels, generated
    answers or learned models participate. Empty output is possible.
    """
    if min(byte_budget, max_sources, window_bytes) < 1:
        raise ValueError("Positive selection limits required")
    query = terms(question)
    token_sets = [terms(c.get("text", "")) for c in contexts]
    frequency = {t: sum(t in tokens for tokens in token_sets) for t in query}
    active = {t for t in query if frequency[t]}
    targets = {t for t in active if frequency[t] <= max(1, len(contexts)//2)} or active
    weights = {t: 1 + math.log((len(contexts)+1)/(frequency[t]+.5)) for t in active}

    def mass(tokens):
        return sum(weights[t] for t in sorted(tokens & active))

    candidates = []
    for rank, context in enumerate(contexts):
        parts = sentences(context)
        title = terms(context.get("title", ""))
        anchor = bool(context.get("kind") == "concept" and title and title <= query)
        choices = []
        for index, sentence in enumerate(parts):
            if len(sentence.encode("utf-8")) > byte_budget:
                continue
            tokens = terms(sentence)
            overlap = tokens & active
            title_support = bool(anchor and title <= tokens)
            if not overlap and not title_support and active:
                continue
            keep = [index]
            for neighbor in (index-1, index+1):
                if 0 <= neighbor < len(parts):
                    adjacent = parts[neighbor]
                    if QUALIFIER.search(adjacent) or terms(adjacent) & targets:
                        proposed = sorted([*keep, neighbor])
                        joined = SEPARATOR.join(parts[i] for i in proposed)
                        if len(joined.encode("utf-8")) <= min(byte_budget, window_bytes):
                            keep = proposed
            excerpt = SEPARATOR.join(parts[i] for i in keep)
            all_tokens = terms(excerpt)
            density = mass(tokens) / max(6, len(tokens))
            definition = bool(re.search(r"\b(is|are|called|define|defined|means)\b", sentence, re.I))
            score = mass(tokens) + 2*density + 2*title_support + .3*definition + .25/(rank+1)
            if not active:
                score = .25/(rank+1) - .00001*index
            choices.append({"rank": rank, "text": excerpt, "tokens": all_tokens, "score": score,
                            "anchor": title_support, "defining": definition, "title": frozenset(title), "index": index})
        if choices:
            # A direct definition wins within a concept; sentence content score
            # otherwise decides. This does not restore the old CE source order.
            definitions = [c for c in choices if c["anchor"] and c["defining"]]
            candidates.append(min(definitions, key=lambda c: (c["index"], -c["score"])) if definitions
                              else max(choices, key=lambda c: (c["score"], -c["index"])))
    selected, seen, covered, used, titles = [], [], set(), 0, set()

    def eligible(candidate):
        signature = normalized(candidate["text"])
        return (used + len(candidate["text"].encode("utf-8")) <= byte_budget
                and not any(signature in previous for previous in seen))

    def take(candidate):
        nonlocal used, covered
        selected.append(candidate)
        used += len(candidate["text"].encode("utf-8"))
        covered |= candidate["tokens"] & targets
        seen.append(normalized(candidate["text"]))
        titles.add(candidate["title"])
        candidates.remove(candidate)

    # Preserve complementary named concepts even if their prose overlaps.
    anchors = sorted((c for c in candidates if c["anchor"]), key=lambda c: (-c["score"], c["rank"]))
    for candidate in anchors:
        if len(selected) == max_sources:
            break
        if candidate["title"] not in titles and eligible(candidate):
            take(candidate)
    while candidates and len(selected) < max_sources:
        viable = [c for c in candidates if eligible(c) and (not selected or (c["tokens"] & targets) - covered)]
        if not viable:
            break
        best = max(viable, key=lambda c: (mass((c["tokens"] & targets) - covered), c["score"], -c["rank"]))
        if selected and best["score"] < .6*selected[0]["score"]:
            break
        take(best)
    return [{**contexts[c["rank"]], "text": c["text"]} for c in selected]
