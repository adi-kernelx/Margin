"""ML3: check a bundle against OKF v0.2 conformance (spec section "Conformance").

A bundle is conformant when
  1. every non-reserved .md file has parseable YAML frontmatter;
  2. every frontmatter block has a non-empty `type`;
  3. reserved files follow their structure: index.md has no frontmatter except
     an optional okf_version at the bundle root, and a body of headed sections
     listing markdown links; log.md uses ISO date headings, newest first.

Soft checks (reported as warnings, never failures, as the spec requires
consumers to tolerate them): broken cross-links, a `verified` written as a bare
mapping, `status` outside draft/stable/deprecated, timestamps without a UTC offset.

    python -m ml.okf.conformance ml/out/bundles/some
"""

import argparse
import re
import sys
from pathlib import Path

import yaml

RESERVED = {"index.md", "log.md"}
LINK = re.compile(r"\[[^\]]+\]\(([^)\s]+)\)")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


def split_frontmatter(text):
    """Return (frontmatter dict or None, body); raise ValueError if the block is not valid YAML."""
    if not text.startswith("---\n"):
        return None, text
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("frontmatter is not closed by ---")
    data = yaml.safe_load(text[4:end]) or {}
    if not isinstance(data, dict):
        raise ValueError("frontmatter is not a mapping")
    return data, text[end + 5:]


def check(bundle):
    bundle = Path(bundle)
    errors, warnings, concepts = [], [], 0
    paths = {p.relative_to(bundle).as_posix() for p in bundle.rglob("*.md")}
    for path in sorted(bundle.rglob("*.md")):
        relative = path.relative_to(bundle).as_posix()
        text = path.read_text(encoding="utf-8")
        try:
            front, body = split_frontmatter(text)
        except (ValueError, yaml.YAMLError) as error:
            errors.append(f"{relative}: unparseable frontmatter ({error})")
            continue
        if path.name == "index.md":
            allowed = {"okf_version"} if path.parent == bundle else set()
            if front is not None and set(front) - allowed:
                errors.append(f"{relative}: index frontmatter may only carry okf_version at the bundle root")
            if not re.search(r"^#{1,6} ", body, re.M) or not LINK.search(body):
                errors.append(f"{relative}: index body needs headed sections listing links")
        elif path.name == "log.md":
            dates = re.findall(r"^#{1,6} (\d{4}-\d{2}-\d{2})\s*$", body, re.M)
            if not dates:
                errors.append(f"{relative}: log needs ISO date headings")
            elif dates != sorted(dates, reverse=True):
                errors.append(f"{relative}: log dates must be newest first")
        else:
            concepts += 1
            if front is None:
                errors.append(f"{relative}: missing frontmatter")
                continue
            if not isinstance(front.get("type"), str) or not front["type"].strip():
                errors.append(f"{relative}: missing or empty type")
            if "status" in front and front["status"] not in ("draft", "stable", "deprecated"):
                warnings.append(f"{relative}: unknown status {front['status']!r}")
            if isinstance(front.get("verified"), dict):
                warnings.append(f"{relative}: verified is a bare mapping (treated as a one-element list)")
            stamps = [front.get("generated", {}).get("at")] + [v.get("at") for v in (
                front.get("verified") if isinstance(front.get("verified"), list) else [front.get("verified") or {}])]
            for stamp in stamps:
                if stamp is not None and not TIMESTAMP.match(str(stamp)):
                    warnings.append(f"{relative}: timestamp {stamp!r} lacks an explicit UTC offset")
        for target in LINK.findall(body):
            if target.startswith("/") and target.endswith(".md") and target[1:] not in paths:
                warnings.append(f"{relative}: broken link {target}")
    return {"conformant": not errors, "concepts": concepts, "errors": errors, "warnings": warnings}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("bundle", type=Path)
    args = parser.parse_args()
    report = check(args.bundle)
    print(f"conformant: {report['conformant']}, concepts: {report['concepts']}, "
          f"errors: {len(report['errors'])}, warnings: {len(report['warnings'])}")
    for line in report["errors"] + report["warnings"]:
        print(" ", line)
    sys.exit(0 if report["conformant"] else 1)


if __name__ == "__main__":
    main()
