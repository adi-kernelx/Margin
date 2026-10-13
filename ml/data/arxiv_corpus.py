"""Resumable, rate-limited arXiv training collection; no frozen files changed.

Content is local/ignored. Fixed per-category quotas precede extraction; papers
are not chosen by classifier scores or automatically generated label counts.
"""
import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from dataclasses import asdict
from email.utils import parsedate_to_datetime
from pathlib import Path

from ml.data.extract_blocks import process_pdf

CATEGORIES = ("math.CO", "math.PR", "math.OC", "stat.TH", "cs.DS", "cs.LG")
ATOM = {"a": "http://www.w3.org/2005/Atom"}
ROOT = Path("ml/out/arxiv_expansion")


def parse_entries(payload, category):
    result = []
    for entry in ET.fromstring(payload).findall("a:entry", ATOM):
        identity = entry.findtext("a:id", "", ATOM).rsplit("/abs/", 1)[-1]
        if not re.fullmatch(r"\d{4}\.\d{4,5}v\d+", identity):
            raise ValueError("Unexpected arXiv identity or API error")
        title = " ".join(entry.findtext("a:title", "", ATOM).split())
        result.append({"id": identity, "base_id": re.sub(r"v\d+$", "", identity),
                       "title": title, "category": category,
                       "pdf_url": f"https://export.arxiv.org/pdf/{identity}.pdf",
                       "source_url": f"https://export.arxiv.org/e-print/{identity}"})
    return result


class Client:
    def __init__(self):
        self.last_request = 0.0
        status = ROOT / "rate_limit.json"
        if status.exists():
            limited = json.loads(status.read_text(encoding="utf-8"))
            value = limited.get("retry_after")
            try:
                resume_at = float(limited["observed_at"]) + max(3.1, float(value))
            except (ValueError, TypeError):
                try:
                    resume_at = parsedate_to_datetime(value).timestamp()
                except (ValueError, TypeError):
                    resume_at = float(limited["observed_at"]) + 900
            if time.time() < resume_at:
                raise ValueError("arXiv cooldown is still active; leave cached work and resume later")

    def get(self, url, limit=40_000_000):
        # One connection, at least 3.1 seconds between request starts.
        time.sleep(max(0, 3.1 - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        request = urllib.request.Request(url, headers={"User-Agent": "MarginResearch/0.1 (local academic corpus; single connection)", "Accept": "*/*"})
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                payload = response.read(limit + 1)
                if len(payload) > limit:
                    raise ValueError("Download exceeds bounded content size")
                if response.status == 206:
                    raise ValueError("Partial HTTP response; refusing to cache an incomplete download")
                declared = response.headers.get("Content-Length")
                if declared is not None and len(payload) != int(declared):
                    raise ValueError("Download length does not match Content-Length")
                return payload
        except urllib.error.HTTPError as error:
            if error.code == 429:
                ROOT.mkdir(parents=True, exist_ok=True)
                (ROOT / "rate_limit.json").write_text(json.dumps({"url": url, "status": 429,
                    "retry_after": error.headers.get("Retry-After"), "observed_at": time.time()}, indent=2), encoding="utf-8")
            raise  # Never cycle endpoints or retry a rate-limit response in a loop.


def select(entries, existing_titles, quota):
    chosen, seen = [], set()
    normalized = {re.sub(r"\W+", "", title.lower()) for title in existing_titles}
    for category in CATEGORIES:
        count = 0
        for paper in entries:
            if paper["category"] != category or paper["base_id"] in seen:
                continue
            if re.sub(r"\W+", "", paper["title"].lower()) in normalized:
                continue
            seen.add(paper["base_id"])
            chosen.append(paper)
            count += 1
            if count == quota:
                break
        if count < quota:
            raise ValueError(f"Insufficient unique papers in {category}")
    return chosen


def replace_unavailable(papers, index):
    """Next unused cached candidate, same category; never select on label yield."""
    history_path = ROOT / "replacements.json"
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else []
    old = papers[index]
    category = old["category"]
    cache = ROOT / (("math.ST" if category == "stat.TH" else category) + ".xml")
    used = {p["base_id"] for p in papers} | {row["unavailable_base_id"] for row in history}
    # Same metadata exclusion rule as the initial selection.
    import pymupdf
    titles = [paper["title"] for paper in papers]
    for path in Path("Test PDFs").glob("*.pdf"):
        with pymupdf.open(path) as doc:
            titles.append(doc.metadata.get("title", ""))
    titles = {re.sub(r"\W+", "", title.lower()) for title in titles}
    for candidate in parse_entries(cache.read_bytes(), category):
        if candidate["base_id"] not in used and re.sub(r"\W+", "", candidate["title"].lower()) not in titles:
            history.append({"unavailable_base_id": old["base_id"], "unavailable_version": old["id"],
                            "replacement": candidate["id"], "reason": "PDF endpoint returned 404", "category": category})
            history_path.write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
            return candidate
    raise ValueError("No unused same-category replacement in cached selection pool")


def audit_selection(papers, size=20):
    """Fixed category-round-robin sample, independent of download success."""
    if not 1 <= size <= len(papers):
        raise ValueError("Audit sample size must be within the paper population")
    buckets = [[paper for paper in papers if paper["category"] == category] for category in CATEGORIES]
    if sum(map(len, buckets)) != len(papers):
        raise ValueError("Unknown audit category")
    ordered = [bucket[rank] for rank in range(max(map(len, buckets))) for bucket in buckets if rank < len(bucket)]
    return ordered[:size]


def write_audit_download_list(papers, size=20):
    """Offline handoff of exact source versions and their local cache paths."""
    audit_path = ROOT / "latex_audit.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8")) if audit_path.exists() else {}
    readable = {paper["id"] for paper in audit.get("papers", []) if paper.get("source_error") is None}
    records = [{"id": paper["id"], "title": paper["title"], "category": paper["category"],
                "needed": paper["id"] not in readable,
                "abstract_url": f"https://arxiv.org/abs/{paper['id']}",
                "source_url": paper["source_url"],
                "save_as": str((ROOT / (paper["id"] + ".source")).resolve())}
               for paper in audit_selection(papers, size)]
    ROOT.mkdir(parents=True, exist_ok=True)
    target = ROOT / "audit_downloads.json"
    target.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quota", type=int, default=20)
    parser.add_argument("--sources", type=int, default=20)
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--source-delay", type=float, default=30.0, help="Additional delay before each source-archive download")
    parser.add_argument("--list-sources", action="store_true", help="Write exact-version manual download list from cached metadata; no network requests")
    args = parser.parse_args()
    if not 1 <= args.quota <= 25 or not 0 <= args.sources <= args.quota * 6:
        raise ValueError("Quota must be 1..25, sources within corpus size")
    if args.source_delay < 3.1:
        raise ValueError("Source delay must be at least 3.1 seconds")
    ROOT.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / "manifest.json"
    if args.list_sources:
        papers = json.loads(manifest_path.read_text(encoding="utf-8"))
        print(write_audit_download_list(papers, args.sources))
        return
    client = Client()
    if manifest_path.exists():
        papers = json.loads(manifest_path.read_text(encoding="utf-8"))
        if len(papers) != args.quota * 6:
            raise ValueError("Existing collection has another quota")
    else:
        entries = []
        for category in CATEGORIES:
            api_category = "math.ST" if category == "stat.TH" else category
            query = f"cat:{api_category}"
            if category == "cs.LG":
                query += " AND (ti:theory OR ti:theoretical OR ti:convergence OR ti:generalization)"
            # Fixed historical window avoids a moving newest-paper population.
            query += " AND submittedDate:[202501010000 TO 202512312359]"
            url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(
                {"search_query": query, "start": 0, "max_results": 80, "sortBy": "submittedDate", "sortOrder": "descending"})
            cache = ROOT / (api_category + ".xml")
            if not cache.exists():
                cache.write_bytes(client.get(url, limit=3_000_000))
            entries.extend(parse_entries(cache.read_bytes(), category))
        # Source identities can be hidden behind renamed local PDFs: compare
        # embedded titles and reject exact PDF-content duplicates again later.
        import pymupdf
        existing_titles = []
        for path in Path("Test PDFs").glob("*.pdf"):
            with pymupdf.open(path) as doc:
                existing_titles.append(doc.metadata.get("title", ""))
        papers = select(entries, existing_titles, args.quota)
        manifest_path.write_text(json.dumps(papers, indent=2) + "\n", encoding="utf-8")
    # Spread source checks across categories, rather than taking the first 20 CO papers.
    source_ids = {paper["id"] for paper in audit_selection(papers, args.sources)} if args.sources else set()
    hashes = {hashlib.sha256(path.read_bytes()).hexdigest() for path in Path("Test PDFs").glob("*.pdf")}
    for index, paper in enumerate(papers):
        while True:
            pdf = ROOT / (paper["id"] + ".pdf")
            if pdf.exists():
                break
            url = paper["pdf_url"]
            try:
                payload = client.get(url if url.endswith(".pdf") else url + ".pdf")
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
                replacement = replace_unavailable(papers, index)
                if paper["id"] in source_ids:
                    source_ids.remove(paper["id"])
                    source_ids.add(replacement["id"])
                paper = papers[index] = replacement
                manifest_path.write_text(json.dumps(papers, indent=2) + "\n", encoding="utf-8")
                print("Recorded unavailable PDF; using next same-category metadata candidate", flush=True)
                continue
            if not payload.startswith(b"%PDF-"):
                raise ValueError("Non-PDF response; stopping rather than retrying aggressively")
            pdf.write_bytes(payload)
            break
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if digest in hashes:
            raise ValueError("Duplicate PDF content overlaps existing or new source; stopping")
        hashes.add(digest)
        if paper["id"] in source_ids:
            from ml.eval.latex_audit import read_tex
            archive = ROOT / (paper["id"] + ".source")
            if archive.exists():
                try:
                    read_tex(archive.read_bytes())
                except (EOFError, OSError, ValueError):
                    # Preserve failed downloads for diagnosis, never overwrite
                    # them or treat them as successful cached sources.
                    archive.rename(archive.with_name(archive.name + f".invalid-{time.time_ns()}"))
            if not archive.exists():
                time.sleep(args.source_delay)
                payload = client.get(paper["source_url"])
                if payload.lstrip().lower().startswith((b"<!doctype html", b"<html")):
                    raise ValueError("Source endpoint returned HTML rather than a source archive")
                read_tex(payload)  # Require complete bounded source before caching.
                archive.write_bytes(payload)
        blocks_path = ROOT / (paper["id"] + ".blocks.jsonl")
        if args.extract and not blocks_path.exists():
            result = process_pdf(str(pdf), pdf.name, "arxiv-" + paper["base_id"], "paper")
            blocks_path.write_text("".join(json.dumps(asdict(block), ensure_ascii=False) + "\n" for block in result.blocks), encoding="utf-8")
        print(f"{index+1}/{len(papers)} cached/extracted", flush=True)


if __name__ == "__main__":
    main()
