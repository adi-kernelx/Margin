"""Validate human-authored questions against native PDF text and frozen sources.

Read-only: no labels, questions or split files are modified. Quotes match after
removing whitespace only, preserving case, punctuation and mathematical symbols.
Success verifies evidence location, not whether a question is correctly answered
by that evidence or truly unanswerable; those judgments remain human work.
"""

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf


TYPES = {"definition", "theorem-lookup", "needs-definition", "explain", "other"}
REQUIRED = {"qid", "file", "group", "question", "answer_pages", "answer_quote", "type", "answerable"}


def compact(text):
    return re.sub(r"\s+", "", text)


def group_splits(split):
    if split.get("status") != "frozen":
        raise ValueError("Evaluation requires a frozen split")
    lookup = {}
    for name in ("train", "test", "excluded"):
        for group in split[name + "_groups"]:
            if group in lookup:
                raise ValueError("Duplicate/overlapping split group")
            lookup[group] = name
    return lookup


def validate_record(row, manifest, splits, page_texts):
    """Return a copy with derived split; injected PDF reader keeps tests small."""
    if not isinstance(row, dict) or not REQUIRED <= row.keys() or row.keys() - REQUIRED - {"split"}:
        raise ValueError("Expected schema fields; only optional extra field is split")
    for key in ("qid", "file", "group", "question"):
        if not isinstance(row[key], str) or not row[key].strip():
            raise ValueError(f"{key} must be a nonempty string")
    if type(row["answerable"]) is not bool:
        raise ValueError("answerable must be a boolean")
    if not isinstance(row["type"], str) or row["type"] not in TYPES:
        raise ValueError("Unknown question type")
    pages = row["answer_pages"]
    if not isinstance(pages, list) or any(type(page) is not int or page < 1 for page in pages):
        raise ValueError("answer_pages must contain positive integer physical PDF pages")
    if len(pages) != len(set(pages)):
        raise ValueError("Duplicate answer page")
    if not isinstance(row["answer_quote"], str):
        raise ValueError("answer_quote must be a string")
    entry = manifest.get(row["file"])
    if entry is None:
        raise ValueError("File not in manifest")
    if entry["group"] != row["group"]:
        raise ValueError("Group does not match manifest")
    name = splits.get(row["group"])
    if name not in {"train", "test"} or entry["use"] not in {"main", "other"}:
        raise ValueError("File/source is excluded from native-text evaluation")
    if "split" in row and row["split"] != name:
        raise ValueError(f"split must be {name}, derived from the frozen group")
    texts = page_texts(row["file"])
    if any(page > len(texts) for page in pages):
        raise ValueError("Answer page exceeds actual PDF page count")
    quote = compact(row["answer_quote"])
    if row["answerable"]:
        if not pages or not quote:
            raise ValueError("Answerable questions need pages and a nonempty supporting quote")
        if not any(quote in compact(texts[page - 1]) for page in pages):
            raise ValueError("Quote not found on any listed answer page (whitespace ignored)")
    elif pages or row["answer_quote"] != "":
        raise ValueError("Unanswerable questions require answer_pages=[] and answer_quote=\"\"")
    return dict(row, split=name)


def validate_lines(lines, manifest, splits, page_texts):
    valid, errors, seen = [], [], set()
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line.lstrip("\ufeff") if line_number == 1 else line)
            row = validate_record(row, manifest, splits, page_texts)
            if row["qid"] in seen:
                raise ValueError("Duplicate qid")
            seen.add(row["qid"])
            valid.append(row)
        except (ValueError, OSError, pymupdf.FileDataError, pymupdf.FileNotFoundError) as error:
            errors.append(f"line {line_number}: {error}")
    if not valid and not errors:
        errors.append("Question file is empty")
    return valid, errors


def summarise(rows):
    result = {key: dict(sorted(Counter(row[key] for row in rows).items())) for key in ("type", "file", "split")}
    result["answerability"] = {"answerable": sum(row["answerable"] for row in rows),
                               "unanswerable": sum(not row["answerable"] for row in rows)}
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", type=Path, default=Path("ml/eval/questions.jsonl"))
    parser.add_argument("--manifest", type=Path, default=Path("Test PDFs/manifest.csv"))
    parser.add_argument("--split", type=Path, default=Path("ml/splits.json"))
    parser.add_argument("--pdf-dir", type=Path, default=Path("Test PDFs"))
    parser.add_argument("--require-complete", action="store_true", help="Require 200 questions, ~15 PDFs, 8–15 per PDF, and ~40 unanswerable")
    args = parser.parse_args(argv)
    try:
        with args.manifest.open(encoding="utf-8", newline="") as source:
            entries = list(csv.DictReader(source))
        manifest = {row["file"]: row for row in entries}
        if len(manifest) != len(entries):
            raise ValueError("Duplicate manifest file")
        splits = group_splits(json.loads(args.split.read_text(encoding="utf-8")))
        cache = {}
        pdf_root = args.pdf_dir.resolve()

        def page_texts(filename):
            if filename not in cache:
                path = (pdf_root / filename).resolve()
                if path.parent != pdf_root:
                    raise ValueError("Manifest file path escapes PDF directory")
                with pymupdf.open(path) as document:
                    cache[filename] = [page.get_text() for page in document]
            return cache[filename]

        with args.questions.open(encoding="utf-8") as source:
            rows, errors = validate_lines(source, manifest, splits, page_texts)
        summary = summarise(rows)
        print(f"Valid questions: {len(rows)}; invalid lines: {len(errors)}")
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        if args.require_complete:
            counts = summary["file"].values()
            if (len(rows) != 200 or not 13 <= len(counts) <= 17 or
                    any(not 8 <= count <= 15 for count in counts) or
                    not 35 <= summary["answerability"]["unanswerable"] <= 45 or
                    set(summary["split"]) != {"train", "test"}):
                errors.append("Collection incomplete: need 200 questions, 13–17 PDFs, 8–15 per PDF, 35–45 unanswerable, train and test")
        for error in errors:
            print(error, file=sys.stderr)
        print("VALID" if not errors else "INVALID", file=sys.stderr if errors else sys.stdout)
        return 1 if errors else 0
    except (ValueError, OSError, KeyError) as error:
        print(f"Cannot validate: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
