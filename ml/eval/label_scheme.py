"""ML2.8 scoring scheme: merged labels and estimable classes.

Hand labels and weak labels keep all seven classes; merging happens only here,
at training/scoring time, so a finer label can always be recovered later.

- notation -> definition: a notation statement defines a symbol, and only 4
  weak-labelled notation rows exist in the training sources.
- other stays a training class (it is useful negative evidence) but is never
  averaged into macro F1: remarks/notes are not something the product extracts.
- A class enters macro F1 only if it is estimable: present in enough independent
  sources AND enough development folds. A class concentrated in one fold has
  almost no training rows when that fold is held out, so its F1 of zero is a
  property of the split, not of the model.
"""

from collections import defaultdict

from ml.data.make_splits import LABELS

MERGE = {"notation": "definition"}
UNSCORED = ("other",)
MERGED_LABELS = tuple(label for label in LABELS if label not in MERGE)
MIN_SOURCES = 3
MIN_FOLDS = 3


def merge_label(label):
    if label not in LABELS:
        raise ValueError(f"Unknown label {label!r}")
    return MERGE.get(label, label)


def merge_rows(rows):
    """Return copies of rows with merged labels; inputs are not modified."""
    return [{**row, "label": merge_label(row["label"])} for row in rows]


def class_coverage(rows, labels=MERGED_LABELS, min_sources=MIN_SOURCES, min_folds=MIN_FOLDS):
    """Count rows, sources and folds per class and decide estimability."""
    sources, folds, counts = defaultdict(set), defaultdict(set), defaultdict(int)
    for row in rows:
        sources[row["label"]].add(row["group"])
        folds[row["label"]].add(row["fold"])
        counts[row["label"]] += 1
    return {label: {"rows": counts[label], "sources": len(sources[label]), "folds": len(folds[label]),
                    "estimable": len(sources[label]) >= min_sources and len(folds[label]) >= min_folds}
            for label in labels}


def scored_labels(coverage):
    """Classes averaged into macro F1: estimable and not deliberately unscored."""
    return tuple(label for label, info in coverage.items() if info["estimable"] and label not in UNSCORED)


# Coarse 3-way scheme for the definition detector: what the OKF bundle needs is
# definitions and theorem-like statements; every other role is "neither". The
# existing label names are reused (theorem = statement, other = neither) so the
# label validators need no change.
COARSE = {"definition": "definition", "notation": "definition", "theorem": "theorem",
          "proof": "other", "example": "other", "algorithm": "other", "other": "other"}
COARSE_LABELS = ("definition", "theorem", "other")
COARSE_SCORED = ("definition", "theorem")


def coarse_rows(rows):
    """Return copies of rows relabelled definition / theorem (statement) / other (neither)."""
    for row in rows:
        if row["label"] not in COARSE:
            raise ValueError(f"Unknown label {row['label']!r}")
    return [{**row, "label": COARSE[row["label"]]} for row in rows]
