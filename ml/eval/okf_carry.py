"""ML3.2: carry hand labels over to rebuilt bundles.

A concept is matched on (document, block id, defining sentence); a link on
(document, source block, target block). A concept the new build no longer emits
is marked `dropped` (its `real` label is kept, so lost true concepts are counted).
A concept whose title changed gets `title_label: null` and `old_title`, to be
relabelled. A link the new build no longer makes is marked `dropped`.

    python -m ml.eval.okf_carry --labels ml/labels/okf_dev.jsonl --out ml/labels/okf_dev_v1.jsonl
"""

import argparse
import json
from pathlib import Path

from ml.eval.okf_sample import concepts_of


def carry(items, bundles):
    cache = {}
    out = []
    for item in items:
        if item["doc"] not in cache:
            folder = bundles / item["doc"]
            cache[item["doc"]] = concepts_of(folder) if folder.is_dir() else {}
        concepts = cache[item["doc"]]
        by_key = {(meta["margin"]["block_id"], sentence): (path, meta) for path, (meta, sentence, _, _) in concepts.items()}
        item = dict(item)
        if item["kind"] == "concept":
            match = by_key.get((item["block_id"], item["sentence"]))
            item["dropped"] = match is None
            if match and match[1]["title"] != item["title"]:
                item["old_title"], item["title"] = item["title"], match[1]["title"]
                # a title is only judged on real concepts; a non-real one stays "bad"
                item["old_title_label"] = item["title_label"]
                item["title_label"] = None if item["real"] == "yes" else "bad"
            if match:
                item["type"], item["path"] = match[1]["type"], match[0]
        else:
            block_of = {path: meta["margin"]["block_id"] for path, (meta, *_) in concepts.items()}
            pairs = {(meta["margin"]["block_id"], block_of.get(target))
                     for path, (meta, _, _, uses) in concepts.items() for _, target in uses}
            item["dropped"] = (item["block_id"], item["target_block_id"]) not in pairs
        out.append(item)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--bundles", type=Path, default=Path("ml/out/bundles"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    items = [json.loads(line) for line in args.labels.read_text(encoding="utf-8").splitlines()]
    out = carry(items, args.bundles)
    args.out.write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in out), encoding="utf-8")
    print(f"dropped concepts {sum(i['dropped'] for i in out if i['kind'] == 'concept')}, "
          f"titles to relabel {sum(i['kind'] == 'concept' and i['title_label'] is None and not i['dropped'] for i in out)}, "
          f"dropped links {sum(i['dropped'] for i in out if i['kind'] == 'link')}")


if __name__ == "__main__":
    main()
