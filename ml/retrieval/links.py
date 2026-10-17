"""Bounded one-hop expansion over a document's indexed OKF concepts."""

import re
from urllib.parse import unquote, urlsplit

SEED_COUNT = 8
LINK_LIMIT = 4
RESULT_TYPES = frozenset(("Theorem", "Lemma", "Proposition", "Corollary", "Claim", "Conjecture", "Fact", "Observation"))
DEFINITION_TYPES = frozenset(("Definition", "Notation"))


def concept_uses(markdown):
    """Read local bundle paths only from the writer's # Uses section."""
    section = re.search(r"^# Uses[ \t]*\r?\n(.*?)(?=^# |\Z)", markdown, re.M | re.S)
    if not section:
        return []
    paths = []
    for target in re.findall(r"^\s*-\s+\[[^\r\n]*?\]\(([^\s)]+)\)", section[1], re.M):
        target = unquote(target)
        try:
            url = urlsplit(target)
        except ValueError:
            continue
        if (url.scheme or url.netloc or url.query or url.fragment or "\\" in target or
                target.startswith("//") or any(ord(char) < 32 for char in target)):
            continue
        path = target.removeprefix("/")
        if not path.endswith(".md") or any(part in ("", ".", "..") for part in path.split("/")):
            continue
        if path not in paths:
            paths.append(path)
    return paths


def expand_one_hop(items, base, budget, seed_count=SEED_COUNT, link_limit=LINK_LIMIT):
    """Protect the fused prefix and include bounded dependencies, keeping ranks.

    Only original seeds expand; dependencies never become new seeds. Lookup
    uses (fingerprint, path), so identical paths in other PDFs cannot join.
    """
    base = list(dict.fromkeys(base))[:max(0, budget)]
    seeds = base[:max(0, seed_count)]
    limit = min(max(0, link_limit), max(0, budget - len(seeds)))
    lookup = {(item.get("pdfFingerprint"), item.get("conceptPath")): i
              for i, item in enumerate(items) if item.get("kind") == "concept" and item.get("pdfFingerprint")}
    targets = []
    for source in seeds:
        item = items[source]
        if item.get("kind") != "concept" or item.get("type") not in RESULT_TYPES:
            continue
        for path in item.get("uses", []):
            target = lookup.get((item.get("pdfFingerprint"), path))
            if (target is not None and target != source and items[target].get("type") in DEFINITION_TYPES
                    and target not in targets and len(targets) < limit):
                targets.append(target)
    selected = set(seeds) | set(targets)
    for index in base:
        if len(selected) < budget:
            selected.add(index)
    order = [index for index in base if index in selected]
    order.extend(index for index in targets if index not in base)
    return order, set(targets)
