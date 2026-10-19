"""Conservative same-page evidence consolidation; no labels or models."""

import re

from ml.retrieval import focused_contexts as focused


def compact(text):
    return re.sub(r"\s+", "", text)


def scope(context):
    fingerprint, doc = context.get("pdfFingerprint"), context.get("docId")
    page = context.get("page")
    if fingerprint and doc and fingerprint != doc:
        return None
    identity = fingerprint or doc
    return (identity, page) if isinstance(identity, str) and identity and type(page) is int and page > 0 else None


def units(context):
    """Ignore assembler title prefixes for matching, preserving natural subjects."""
    title = context.get("title", "").strip()
    result = []
    for piece in context.get("text", "").split(focused.SEPARATOR):
        text = piece.strip()
        while context.get("kind") == "concept" and title and text.startswith(title + " "):
            tail = text[len(title):].lstrip()
            if re.match(r"^(is|are|was|were|means|denotes|has|can)\b", tail, re.I):
                break
            text = tail
        result.extend(focused.sentences({"text": text}))
    return result


def carrier_window(items, raw, *, window_bytes):
    """Find a common source that preserves every selected unit, in source order."""
    identity = scope(items[0])
    if identity is None or any(scope(item) != identity for item in items):
        return None
    required = {compact(unit) for item in items for unit in units(item)}
    if not required:
        return None
    candidates = []
    for rank, context in enumerate(raw):
        if scope(context) != identity:
            continue
        parts = units(context)
        spans = []
        for fact in sorted(required):
            matches = [i for i, part in enumerate(parts) if fact in compact(part)]
            if not matches:
                break
            spans.append(matches[0])
        else:
            positions = sorted(set(spans))
            # Never bridge more than one unselected unit at a time.
            if any(b-a > 2 for a, b in zip(positions, positions[1:])):
                continue
            start, end = min(positions), max(positions)
            text = "\n".join(parts[start:end+1])
            if len(text.encode("utf-8")) > window_bytes:
                continue
            # Preserve a short local qualification chain, including exceptions.
            for direction, count in ((-1, 1), (1, 2)):
                for _ in range(count):
                    neighbor = start-1 if direction < 0 else end+1
                    if not 0 <= neighbor < len(parts) or not focused.QUALIFIER.search(parts[neighbor]):
                        break
                    proposed_start, proposed_end = min(start, neighbor), max(end, neighbor)
                    proposed = "\n".join(parts[proposed_start:proposed_end+1])
                    if len(proposed.encode("utf-8")) > window_bytes:
                        break
                    start, end, text = proposed_start, proposed_end, proposed
            # Metadata belongs to the actual containing source, not its children.
            candidates.append((len(text.encode("utf-8")), rank, {**context, "text": text}))
    return min(candidates, key=lambda item: item[:2])[2] if candidates else None


def select_contexts(question, contexts, *, byte_budget=4000, max_sources=4, window_bytes=1400):
    """Merge only when a common same-document/page source proves containment.

    Whole units and intervening text stay in original within-source order.
    Missing identity, distant/disjoint evidence or extra bytes cause fallback
    to the unchanged focused selection. No concatenation invents adjacency.
    """
    selected = focused.select_contexts(question, contexts, byte_budget=byte_budget,
                                       max_sources=max_sources, window_bytes=window_bytes)
    result = list(selected)
    index = 0
    while index < len(result):
        group = [result[index]]
        consumed = []
        replacement = carrier_window(group, contexts, window_bytes=min(window_bytes, byte_budget))

        def fits(value, removed):
            return value is not None and (sum(len(item["text"].encode("utf-8")) for i, item in enumerate(result)
                                              if i not in removed) + len(value["text"].encode("utf-8")) <= byte_budget)

        if not fits(replacement, {index}):
            replacement = None
        for other in range(index+1, len(result)):
            candidate = carrier_window([*group, result[other]], contexts, window_bytes=min(window_bytes, byte_budget))
            if fits(candidate, {index, *consumed, other}):
                group.append(result[other])
                consumed.append(other)
                replacement = candidate
        if replacement is not None:
            result[index] = replacement
            for other in reversed(consumed):
                del result[other]
        index += 1
    return result
