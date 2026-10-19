"""Experimental, model-free excerpt selection; no labels or reference answers."""

import re
import unicodedata

STOP = frozenset("a an the this that these those of to for from in on at by with and or as is are was were be been does do did how what which when why under can must here text document notes according satisfy count described collection".split())
SEPARATOR = "\n[…]\n"


def terms(text):
    words = re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", text).casefold())
    return {w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w
            for w in words if w not in STOP and len(w) > 1}


def units(text, byte_limit=900):
    """Keep source substrings; split long sentences at whitespace, never a UTF-8 byte."""
    for sentence in re.split(r"(?<=[.!?。])\s+|\n\s*\n", text):
        sentence = sentence.strip()
        while len(sentence.encode("utf-8")) > byte_limit:
            prefix = sentence.encode("utf-8")[:byte_limit].decode("utf-8", errors="ignore")
            if not prefix:
                break
            boundary = max(prefix.rfind(" "), prefix.rfind("\n"))
            cut = boundary if boundary > len(prefix) // 2 else len(prefix)
            yield sentence[:cut].strip()
            sentence = sentence[cut:].strip()
        if sentence and len(sentence.encode("utf-8")) <= byte_limit:
            yield sentence


def normalized(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def select_contexts(question, contexts, *, byte_budget=4000, max_sources=6):
    """Greedy lexical coverage, source diversity and CE-order prior within a hard cap.

    Text bytes include omission markers, but not prompt labels/metadata. This is
    an experimental heuristic, not a semantic relevance or support guarantee.
    """
    if byte_budget < 1 or max_sources < 1:
        raise ValueError("Positive context limits required")
    query = terms(question)
    candidates = []
    for rank, context in enumerate(contexts):
        text = context.get("text", "")
        title = context.get("title", "")
        # Concept assembly prepends a title with no separator before its body.
        if title and text.casefold().startswith(title.casefold() + " "):
            text = text[len(title):].lstrip()
        for index, excerpt in enumerate(units(text, min(900, byte_budget))):
            tokens = terms(excerpt)
            overlap = tokens & query
            title_terms = terms(title)
            title_match = bool(title_terms and title_terms <= query and title_terms <= tokens)
            definition = bool(re.search(r"\b(is|are|means|called|defined)\b", excerpt, re.I))
            score = (3 * len(overlap) / max(1, len(query)) + len(overlap) / max(4, len(tokens))
                     + .65 * title_match + .2 * definition + .2 / (rank + 1))
            candidates.append({"rank": rank, "index": index, "text": excerpt, "tokens": tokens,
                               "overlap": overlap, "norm": normalized(excerpt), "score": score})
    selected, seen, covered, used = {}, [], set(), 0
    while candidates:
        feasible = []
        for c in candidates:
            rank = c["rank"]
            if rank not in selected and len(selected) >= max_sources:
                continue
            # Exact containment removes repeated concept descriptions/body and
            # overlapping passage copies without conflating complementary facts.
            if any(c["norm"] in n or n in c["norm"] for n in seen):
                continue
            if not c["overlap"] and selected:
                continue
            cost = len(c["text"].encode("utf-8")) + (len(SEPARATOR.encode("utf-8")) if rank in selected else 0)
            if used + cost > byte_budget:
                continue
            score = c["score"] + 1.5 * len(c["overlap"] - covered) / max(1, len(query))
            score += .25 if rank not in selected else 0
            feasible.append((score, -rank, -c["index"], c, cost))
        if not feasible:
            break
        _, _, _, best, cost = max(feasible, key=lambda v: v[:3])
        selected.setdefault(best["rank"], []).append(best)
        seen.append(best["norm"])
        covered |= best["overlap"]
        used += cost
        candidates.remove(best)
    output = []
    for rank, excerpts in sorted(selected.items()):
        output.append({**contexts[rank], "text": SEPARATOR.join(c["text"] for c in sorted(excerpts, key=lambda c: c["index"]))})
    return output
