"""Write self-contained batch files for an independent second annotator.

Each batch is a Markdown file: the annotation guide, then the blocks (id, file,
page, text) and the output instructions. No existing label, weak label or model
prediction is included, so the second annotation is blind. Output goes to the
git-ignored ml/labels/second_annotator/ folder because it contains PDF text.

Usage:
    python -m ml.data.export_for_annotator            # 6 batches of 50
    python -m ml.data.export_for_annotator --size 100 # fewer, larger batches
"""

import argparse
import json
from pathlib import Path

GUIDE = Path("ml/labels/ANNOTATION_GUIDE.md")
HEADER = """You are an independent annotator. Read the guide below, then label every block
in this batch. Reply with JSON Lines only (one line per block, in order), no
commentary. This is batch {index} of {total} ({count} blocks).

"""
FOOTER = """
---

Reply now with exactly {count} JSON lines, one per block above, in the same order:
{{"block_id": "...", "label": "...", "contains_definition": true|false}}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sample", type=Path, default=Path("ml/labels/to_label.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("ml/labels/second_annotator"))
    parser.add_argument("--size", type=int, default=50)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.sample.read_text(encoding="utf-8").splitlines() if line.strip()]
    guide = GUIDE.read_text(encoding="utf-8")
    batches = [rows[i:i + args.size] for i in range(0, len(rows), args.size)]
    args.out.mkdir(parents=True, exist_ok=True)
    for index, batch in enumerate(batches, 1):
        parts = [HEADER.format(index=index, total=len(batches), count=len(batch)), guide, "\n---\n\n# Blocks\n"]
        for number, row in enumerate(batch, 1):
            text = " ".join(row["text"].split())
            parts.append(f"\n## {number}. block_id: `{row['block_id']}`\n"
                         f"Source: {row['file']}, page {row['page']}\n\n{text}\n")
        parts.append(FOOTER.format(count=len(batch)))
        (args.out / f"batch_{index:02d}.md").write_text("".join(parts), encoding="utf-8")
    (args.out / "README.txt").write_text(
        "1. Give each batch_XX.md to the other AI, one at a time, in a fresh chat if possible.\n"
        "2. Paste each reply into batch_XX.jsonl next to it (same number).\n"
        "3. Run: python -m ml.eval.compare_annotators\n", encoding="utf-8")
    print(f"{len(batches)} batches written to {args.out}")


if __name__ == "__main__":
    main()
