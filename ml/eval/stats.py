"""Percentile intervals from resampling entire documents, not questions."""

import random


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def document_bootstrap(values_by_file, resamples=2000, seed=20261006):
    """Question-weighted mean; bootstrap clusters are complete source files.

    Repeated sampled documents repeat ALL their questions. With one document
    the interval is necessarily degenerate, not evidence of high certainty.
    """
    files = sorted(values_by_file)
    if not files or resamples < 1 or any(not values_by_file[file] for file in files):
        raise ValueError("Need nonempty document clusters and positive resamples")
    sums = {file: sum(values_by_file[file]) for file in files}
    counts = {file: len(values_by_file[file]) for file in files}
    estimate = sum(sums.values()) / sum(counts.values())
    rng = random.Random(seed)
    means = []
    for _ in range(resamples):
        sampled = [rng.choice(files) for _ in files]
        means.append(sum(sums[file] for file in sampled) / sum(counts[file] for file in sampled))
    return {"value": estimate, "ci95": [percentile(means, .025), percentile(means, .975)],
            "documents": len(files), "questions": sum(counts.values())}


def cluster_bootstrap(rows, statistic, key="file", resamples=2000, seed=20261006):
    """95% percentile interval for statistic(rows), resampling whole clusters.

    `statistic` maps a list of rows to a number, or None when undefined on a
    resample (for example a recall with no positives); those resamples are
    skipped and their count is returned, so a sparse interval is visible.
    """
    clusters = {}
    for row in rows:
        clusters.setdefault(row[key], []).append(row)
    names = sorted(clusters)
    if not names or resamples < 1:
        raise ValueError("Need nonempty clusters and positive resamples")
    rng = random.Random(seed)
    values = []
    for _ in range(resamples):
        sampled = [row for _ in names for row in clusters[rng.choice(names)]]
        value = statistic(sampled)
        if value is not None:
            values.append(value)
    if not values:
        return {"ci95": None, "undefined_resamples": resamples}
    return {"ci95": [percentile(values, .025), percentile(values, .975)],
            "undefined_resamples": resamples - len(values)}
