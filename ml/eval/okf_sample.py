"""ML3.2: sample concepts and links from built OKF bundles for a gold check.

Each document contributes at most --per-doc concepts and --per-doc links, so the
two textbooks (two thirds of all concepts) do not dominate. Items already in an
--exclude file (matched on document and block id, or on source and target) are
skipped, so a held-out test sample never repeats a development item.

Concept labels (filled by hand):
  real   yes | no         the block really states this kind of thing: a definition
                          introduces a term or symbol, a result states a claim,
                          notation fixes a symbol, an algorithm gives steps
  title  good | partial | bad
                          good: the name a reader would search for
                          partial: right concept but vague or incomplete
                          ("Definition 2.1" with no term, a symbol for a named idea)
                          bad: wrong, a clause fragment, or another concept's name
Link labels:
  link_ok yes | no        the source text really refers to the target concept
                          (same sense, not a coincidental word match)

    python -m ml.eval.okf_sample --out ml/labels/okf_dev.jsonl --seed 1
"""

import argparse
import json
import random
import re
from pathlib import Path

import yaml


def read_concept(path):
    text = path.read_text(encoding="utf-8")
    _, front, rest = text.split("---\n", 2)
    meta = yaml.safe_load(front)
    rest = rest.lstrip()
    sentence = None
    body = rest
    if rest.startswith("> "):
        sentence, _, body = rest.partition("\n")
        sentence = sentence[2:]
    body = body.split("\n# Proof\n")[0].split("\n# Uses\n")[0].strip()
    uses = re.findall(r"^- \[(.+?)\]\(/(.+?)\)$", rest, re.M)
    return meta, sentence, body, uses


def concepts_of(bundle):
    found = {}
    for path in sorted(bundle.rglob("*.md")):
        if path.name in ("index.md", "log.md"):
            continue
        found[path.relative_to(bundle).as_posix()] = read_concept(path)
    return found


def excerpt(body, title, width=500):
    """The part of the body around the first mention of `title`, else its start."""
    match = re.search(r"\b" + re.escape(title) + r"\b", body, re.I)
    start = max(0, match.start() - width // 2) if match else 0
    return ("…" if start else "") + body[start:start + width].strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bundles", type=Path, default=Path("ml/out/bundles"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--per-doc", type=int, default=3)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--exclude", type=Path, action="append", default=[])
    args = parser.parse_args()
    seen = set()
    for path in args.exclude:
        for line in path.read_text(encoding="utf-8").splitlines():
            item = json.loads(line)
            seen.add((item["doc"], item.get("block_id") or "", item.get("target_block_id") or ""))
    rng = random.Random(args.seed)
    items = []
    for bundle in sorted(p for p in args.bundles.iterdir() if p.is_dir()):
        concepts = concepts_of(bundle)
        keys = [k for k, (meta, *_) in concepts.items() if (bundle.name, meta["margin"]["block_id"], "") not in seen]
        for key in rng.sample(keys, min(args.per_doc, len(keys))):
            meta, sentence, body, _ = concepts[key]
            items.append({"kind": "concept", "doc": bundle.name, "path": key, "block_id": meta["margin"]["block_id"],
                          "type": meta["type"], "title": meta["title"], "method": meta["margin"]["method"],
                          "page": meta["margin"]["page"], "sentence": sentence, "body": body[:700],
                          "real": None, "title_label": None})
        links = [(key, target, title) for key, (meta, _, _, uses) in concepts.items() for title, target in uses
                 if target in concepts]
        links = [l for l in links if (bundle.name, concepts[l[0]][0]["margin"]["block_id"],
                                      concepts[l[1]][0]["margin"]["block_id"]) not in seen]
        for key, target, title in rng.sample(links, min(args.per_doc, len(links))):
            source, goal = concepts[key], concepts[target]
            items.append({"kind": "link", "doc": bundle.name, "path": key, "target": target,
                          "block_id": source[0]["margin"]["block_id"], "target_block_id": goal[0]["margin"]["block_id"],
                          "source_title": source[0]["title"], "target_title": title,
                          "source_excerpt": excerpt(source[2], re.sub(r"^\w+ ([\d.]+).*", r"\1", title)
                                                    if re.match(r"^[A-Z][a-z]+ [\d.]+", title) else title),
                          "target_text": (goal[1] or goal[2])[:300], "link_ok": None})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items), encoding="utf-8")
    print(f"{sum(i['kind'] == 'concept' for i in items)} concepts, {sum(i['kind'] == 'link' for i in items)} links "
          f"-> {args.out}")


if __name__ == "__main__":
    main()
