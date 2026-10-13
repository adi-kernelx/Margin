"""Conservative source-environment cross-check, not independent human gold.

Read archives in memory; never extract or execute LaTeX. Precision is reported
only on uniquely aligned blocks, alongside unresolved coverage and a lower
bound across all automatic labels. Unmatched blocks are unknown, not errors.
"""
import gzip
import io
import json
import re
import random
import tarfile
from collections import Counter
from pathlib import PurePosixPath

from ml.data.arxiv_corpus import ROOT, audit_selection
from ml.data.heading_rules import _SUBTYPE_TO_LABEL
from ml.eval.stats import percentile

LIMIT = 20_000_000


def read_tex(payload):
    """Bounded TeX/style/class members only; reject unsafe paths, execute none."""
    # Read through the gzip footer before parsing tar: a readable prefix is
    # not a complete archive. Bound decompression, including non-TeX members.
    if payload.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
            payload = stream.read(LIMIT + 1)
        if len(payload) > LIMIT:
            raise ValueError("Source exceeds decompressed size bound")
    result, total = [], 0
    try:
        archive = tarfile.open(fileobj=io.BytesIO(payload), mode="r:*")
    except tarfile.ReadError:
        stream = gzip.GzipFile(fileobj=io.BytesIO(payload)) if payload.startswith(b"\x1f\x8b") else io.BytesIO(payload)
        with stream:
            data = stream.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise ValueError("Source exceeds decompressed size bound")
        text = data.decode("utf-8", errors="replace")
        return [text] if "\\begin{" in text else []
    with archive:
        for index, member in enumerate(archive):
            if index >= 2000:
                raise ValueError("Too many archive members")
            path = PurePosixPath(member.name.replace("\\", "/"))
            if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
                raise ValueError("Unsafe source member")
            total += member.size
            if total > LIMIT or member.size > LIMIT:
                raise ValueError("Source exceeds decompressed size bound")
            if not member.isfile() or path.suffix.lower() not in {".tex", ".sty", ".cls"}:
                continue
            with archive.extractfile(member) as stream:
                result.append(stream.read(member.size).decode("utf-8", errors="replace"))
    return result


OPERATORS = ("exp", "log", "lim", "liminf", "limsup", "sup", "inf", "max", "min", "argmax", "argmin",
             "sin", "cos", "tan", "det", "dim", "ker", "deg", "gcd", "var", "cov", "tr", "Pr")
SHORT_ANCHOR = 5        # anchor length for bodies under eight words
OVERLAP_MIN = 0.8       # word-overlap fallback: share of the block's opening words found in the environment
OVERLAP_MARGIN = 0.2    # ... and this far ahead of the runner-up environment


def tokens(text, latex=False):
    if latex:
        text = re.sub(r"\\(?:label|ref|eqref|cite|citep|citet)\*?(?:\[[^]]*\])?\{[^}]*\}", " ", text)
        # Operators print their own name in the PDF ("exp", "lim"); keep it.
        text = re.sub(r"\\(" + "|".join(OPERATORS) + r")\b", r" \1 ", text)
        text = re.sub(r"\\[A-Za-z]+\*?", " ", text)
    # Repair common PDF ligatures, but don't fuzzy-match arbitrary words.
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl").replace("ﬀ", "ff")
    return re.findall(r"[a-z]{3,}", text.lower())


def environments(texts):
    clean = [re.sub(r"(?<!\\)%[^\n]*", "", text) for text in texts]
    aliases = dict(_SUBTYPE_TO_LABEL)
    for text in clean:
        for name, title in re.findall(r"\\newtheorem\*?\s*\{([^}]+)\}\s*(?:\[[^]]*\]\s*)?\{([^}]+)\}", text):
            label = _SUBTYPE_TO_LABEL.get(title.strip().lower())
            if label:
                aliases[name] = label
    result = []
    for text in clean:
        stack = []
        for match in re.finditer(r"\\(begin|end)\s*\{([^}]+)\}", text):
            action, name = match.groups()
            if action == "begin":
                stack.append((name, match.end()))
            elif stack and stack[-1][0] == name:
                _, start = stack.pop()
                label = aliases.get(name.rstrip("*"))
                if label:
                    result.append({"label": label, "tokens": tokens(text[start:match.start()], latex=True), "environment": name})
    return result


def _anchor_index(envs, size):
    anchors = {}
    for index, env in enumerate(envs):
        for start in range(max(0, len(env["tokens"]) - size + 1)):
            anchors.setdefault(tuple(env["tokens"][start:start + size]), set()).add(index)
    return anchors


def _innermost(candidates, envs):
    """Drop an environment that encloses another candidate (claim inside a proof)."""
    joined = {i: " " + " ".join(envs[i]["tokens"]) + " " for i in candidates}
    return {i for i in candidates
            if not any(j != i and len(joined[j]) < len(joined[i]) and joined[j] in joined[i] for j in candidates)}


def align(body, envs, anchors, short_anchors):
    """Return (environment indices, method) for one block body, or (set(), None).

    Methods, tried in order; each must leave a single source label:
      anchor  - exact 8-word anchors starting in the first 24 words (original rule);
      nested  - several anchored environments, but one is nested in all the others;
      label   - several anchored environments that all carry the same label;
      short   - bodies under 8 words: exact 5-word anchors, unique environment;
      overlap - no anchor: >= 80% of the first 40 words occur in one environment,
                at least 0.2 ahead of the next best.
    """
    size = 8 if len(body) >= 8 else SHORT_ANCHOR
    index = anchors if size == 8 else short_anchors
    matches = set()
    # An appended proof/discussion must not decide a statement's label.
    # Only anchors starting within the first 24 prose tokens can align it.
    for start in range(min(24, max(0, len(body) - size + 1))):
        matches.update(index.get(tuple(body[start:start + size]), set()))
    if len(matches) == 1:
        return matches, "anchor" if size == 8 else "short"
    if len(matches) > 1:
        inner = _innermost(matches, envs)
        if len(inner) == 1:
            return inner, "nested"
        if len({envs[i]["label"] for i in matches}) == 1:
            return matches, "label"
        return set(), None
    opening = body[:40]
    if len(opening) < SHORT_ANCHOR or not envs:
        return set(), None
    scores = sorted(((sum(word in envs[i]["vocabulary"] for word in opening) / len(opening), i)
                     for i in range(len(envs))), reverse=True)
    if scores[0][0] >= OVERLAP_MIN and (len(scores) == 1 or scores[0][0] - scores[1][0] >= OVERLAP_MARGIN):
        return {scores[0][1]}, "overlap"
    return set(), None


def audit_blocks(blocks, envs):
    for env in envs:
        env.setdefault("vocabulary", set(env["tokens"]))
    anchors, short_anchors = _anchor_index(envs, 8), _anchor_index(envs, SHORT_ANCHOR)
    totals = Counter()
    decisions = []
    for block in blocks:
        label = block.get("weak_label")
        if label is None:
            continue
        totals["automatic_labels"] += 1
        matches, method = align(tokens(block["text_without_heading"]), envs, anchors, short_anchors)
        # Conflicting labels and unmatched bodies abstain.
        if not matches:
            totals["unresolved"] += 1
            continue
        expected = envs[next(iter(matches))]["label"]
        totals["resolved"] += 1
        totals["correct" if label == expected else "wrong"] += 1
        decisions.append({"block_id": block["block_id"], "predicted": label, "source_label": expected,
                          "environment": "|".join(sorted({envs[i]["environment"] for i in matches})),
                          "method": method})
    return dict(totals), decisions


def main():
    papers = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    papers = audit_selection(papers, min(20, len(papers)))
    total, details, audit = Counter(), [], []
    readable_sources = 0
    downloaded_sources = 0
    class_counts = {}
    for paper in papers:
        source = ROOT / (paper["id"] + ".source")
        blocks = [json.loads(line) for line in (ROOT / (paper["id"] + ".blocks.jsonl")).read_text(encoding="utf-8").splitlines()]
        failure = None
        quarantined = list(ROOT.glob(paper["id"] + ".source.invalid-*"))
        downloaded = source.exists() or bool(quarantined)
        downloaded_sources += int(downloaded)
        try:
            if not source.exists():
                raise FileNotFoundError("Valid source missing; invalid cache preserved" if quarantined else "Source not downloaded")
            texts = read_tex(source.read_bytes())
            if not texts:
                raise ValueError("Archive contains no readable TeX source files")
            envs = environments(texts)
            readable_sources += 1
        except (EOFError, OSError, tarfile.TarError, ValueError) as error:
            # Still count this paper's predictions as unresolved; don't omit
            # a broken source and silently improve the alignment coverage.
            envs = []
            failure = f"{type(error).__name__}: {error}"
        counts, decisions = audit_blocks(blocks, envs)
        total.update(counts)
        for block in blocks:
            label = block.get("weak_label")
            if label:
                class_counts.setdefault(label, Counter())["automatic_labels"] += 1
        for decision in decisions:
            values = class_counts[decision["predicted"]]
            values["resolved"] += 1
            values["correct" if decision["predicted"] == decision["source_label"] else "wrong"] += 1
        details.append({"id": paper["id"], "category": paper["category"], "environments": len(envs),
                        "downloaded": downloaded, "source_error": failure, **counts})
        audit.extend({"id": paper["id"], **decision} for decision in decisions)
    intervals = []
    rng = random.Random(20261007)
    contributing = sum(row.get("resolved", 0) > 0 for row in details)
    # A boundary-only bootstrap (all matches correct) produces [1, 1], which
    # must not be presented as proof of perfect precision in the population.
    if contributing >= 2 and 0 < total["correct"] < total["resolved"]:
        for _ in range(2000):
            sampled = [rng.choice(details) for _ in details]
            resolved = sum(row.get("resolved", 0) for row in sampled)
            if resolved:
                intervals.append(sum(row.get("correct", 0) for row in sampled) / resolved)
    report = {"selected_papers": len(details), "papers_with_sources": downloaded_sources,
              "papers_with_recognized_environments": sum(p["environments"] > 0 for p in details),
              "readable_sources": readable_sources,
              "status": "complete" if len(details) == readable_sources == 20 else "partial",
              "counts": dict(total), "papers": details,
              "per_class": {label: {**dict(counts), "unresolved": counts["automatic_labels"] - counts["resolved"],
                  "resolved_subset_precision": counts["correct"] / counts["resolved"] if counts["resolved"] else None}
                  for label, counts in sorted(class_counts.items())},
              "resolved_precision_paper_bootstrap_ci95": [percentile(intervals, .025), percentile(intervals, .975)] if intervals else None,
              "interval_note": "No interval with fewer than two contributing papers or no observed variation; zero mismatches does not establish perfect population precision.",
              "resolved_subset_precision": total["correct"] / total["resolved"] if total["resolved"] else None,
              "by_method": {method: {"resolved": sum(1 for row in audit if row["method"] == method),
                                     "correct": sum(1 for row in audit if row["method"] == method
                                                    and row["predicted"] == row["source_label"])}
                            for method in ("anchor", "nested", "label", "short", "overlap")},
              "alignment_coverage": total["resolved"] / total["automatic_labels"] if total["automatic_labels"] else None,
              "verified_correct_fraction_lower_bound": total["correct"] / total["automatic_labels"] if total["automatic_labels"] else None,
              "limitation": "Conditional precision of uniquely aligned prose only; unresolved blocks need human review. Not a gold estimate for all labels; no recall measured. Custom macros and cross-references can defeat alignment."}
    (ROOT / "latex_audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    # Aggregate counts and public arXiv identities only; no source/PDF prose.
    (ROOT.parent.parent / "results" / "arxiv_label_audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (ROOT / "latex_audit_rows.jsonl").write_text("".join(json.dumps(row) + "\n" for row in audit), encoding="utf-8")
    print(json.dumps({key: report[key] for key in report if key != "papers"}, indent=2))


if __name__ == "__main__":
    main()
