"""Network-free collection, frozen-boundary and source-weight regressions."""
import io
import gzip
import tarfile
import json
import time

import pytest

from ml.data.arxiv_corpus import CATEGORIES, parse_entries, select
from ml.data import arxiv_corpus
from ml.data.expand_training import extend_split, training_context
from ml.data.prepare_training import prepare
from ml.eval.classifier_cv import cross_validate, source_weights
from ml.eval.latex_audit import audit_blocks, environments, read_tex
from ml.models.first_classifier import majority_label, validated_weights, fit_tfidf_classifier, fit_tfidf_naive_bayes
from ml.models.improved_classifier import fit_balanced_classifier, fit_word_char_classifier
from ml.models.layout_classifier import fit_layout_classifier
from ml.tests.test_training_data import inputs
from ml.tests.test_classifier_cv import data


def test_uncapped_rows_equal_source_weight():
    blocks, split = inputs()
    for index in range(230):
        blocks.append({**blocks[0], "block_id": f"extra-{index}"})
    rows, report = prepare(blocks, split)
    assert len(rows) == 310 and report["dropped"]["source_cap"] == 0
    assert report["groups"]["a"] == 250
    for group in "abcd":
        assert sum(row["sample_weight"] for row in rows if row["group"] == group) == pytest.approx(1)
    weights = source_weights(rows)
    assert sum(weights) == pytest.approx(len(rows))
    assert weights[0] == pytest.approx(len(rows) / 4 / 250)


@pytest.mark.parametrize("weights", [[1], [1, 0], [1, -1], [1, float("nan")], [1, float("inf")], [1, True], "ab"])
def test_bad_sample_weights(weights):
    with pytest.raises(ValueError):
        validated_weights(weights, 2)


def test_weighted_majority():
    assert majority_label(["proof", "proof", "definition"], [0.5, 0.5, 1]) == "definition"


@pytest.mark.parametrize("fitter", [fit_tfidf_classifier, fit_tfidf_naive_bayes, fit_balanced_classifier, fit_word_char_classifier])
def test_weighted_text_models(fitter):
    model = fitter(["mapping function domain", "suppose hence contradiction", "mapping inverse domain"],
                   ["definition", "proof", "definition"], sample_weight=[.5, 1, .5])
    assert model.predict(["mapping function domain"])[0] in {"definition", "proof"}


def test_weighted_layout_fit():
    blocks, split = inputs()
    rows, _ = prepare(blocks, split)
    model = fit_layout_classifier(rows, [row["label"] for row in rows], sample_weight=source_weights(rows))
    assert len(model.predict(rows[:2])) == 2


def test_cv_weights_only_training_sources():
    rows, split, manifest = data()
    calls = []
    def fit(texts, labels, sample_weight):
        calls.append((texts, sample_weight))
        assert len(texts) == len(sample_weight) == 4
        assert sum(sample_weight) == pytest.approx(4)
        class Model:
            def predict(self, dev):
                assert not set(dev) & set(texts)
                return ["proof"] * len(dev)
        return Model()
    cross_validate(rows, split, manifest, fit=fit, source_weighted=True)
    assert len(calls) == 5


def test_extension_does_not_mutate_frozen():
    _, split = inputs()
    extension = extend_split(split, [{"base_id": "2501.00001"}])
    assert extension["train_groups"][-1] == "arxiv-2501.00001"
    assert "arxiv-2501.00001" not in split["train_groups"]
    assert extension["test_groups"] == split["test_groups"]
    with pytest.raises(ValueError):
        extend_split(extension, [{"base_id": "2501.00001"}])


def test_context_keeps_unlabelled_train_neighbours_not_test_or_excluded():
    from ml.models.definition_features import attach_context
    blocks = [{"block_id": "a", "group": "train", "file": "a.pdf", "page": 1,
               "block_index": 0, "weak_label": None},
              {"block_id": "b", "group": "train", "file": "a.pdf", "page": 1,
               "block_index": 1, "weak_label": "definition"},
              {"block_id": "held", "group": "test"}, {"block_id": "excluded", "group": "excluded"}]
    context = training_context(blocks, {"train_groups": ["train"]})
    assert [block["block_id"] for block in context] == ["a", "b"]
    assert attach_context([{"block_id": "b"}], context)[0]["context"] == "none"


def test_metadata_and_crosslist_dedup():
    payload = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2501.00001v2</id><title> A   title </title></entry></feed>'
    assert parse_entries(payload, "math.CO")[0]["title"] == "A title"
    entries = [{"category": category, "base_id": str(index), "title": str(index)} for index, category in enumerate(CATEGORIES)]
    assert len(select(entries, [], 1)) == 6
    with pytest.raises(ValueError):
        select(entries, ["0"], 1)


def test_cooldown_honors_retry_after_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(arxiv_corpus, "ROOT", tmp_path)
    (tmp_path / "rate_limit.json").write_text(json.dumps({"observed_at": time.time(), "retry_after": "120"}))
    with pytest.raises(ValueError, match="cooldown"):
        arxiv_corpus.Client()


def test_unavailable_replacement_is_same_category_and_recorded(tmp_path, monkeypatch):
    monkeypatch.setattr(arxiv_corpus, "ROOT", tmp_path)
    (tmp_path / "math.CO.xml").write_text('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2501.12345v1</id><title>Unused fixture replacement</title></entry></feed>')
    old = {"category": "math.CO", "base_id": "2501.00001", "id": "2501.00001v2", "title": "Unavailable fixture"}
    replacement = arxiv_corpus.replace_unavailable([old], 0)
    assert replacement["category"] == old["category"]
    assert replacement["base_id"] == "2501.12345"
    assert json.loads((tmp_path / "replacements.json").read_text())[0]["unavailable_base_id"] == old["base_id"]


def test_latex_alias_and_ambiguous_alignment():
    body = "A mapping between these mathematical sets preserves every algebraic operation naturally"
    envs = environments([r"\newtheorem{defi}{Definition}" + r"\begin{defi}" + body + r"\end{defi}"])
    block = {"block_id": "b", "weak_label": "theorem", "text_without_heading": body}
    counts, rows = audit_blocks([block], envs)
    assert counts["wrong"] == 1 and rows[0]["source_label"] == "definition"
    # Two copies with the same label resolve that label; conflicting labels abstain.
    counts, rows = audit_blocks([block], envs * 2)
    assert counts["resolved"] == 1 and rows[0]["method"] == "label"
    proof = environments([r"\begin{proof}" + body + r"\end{proof}"])
    counts, rows = audit_blocks([block], envs + proof)
    assert counts["unresolved"] == 1 and not rows


def test_nested_short_overlap_and_operator_alignment():
    claim = "Every vertex has even degree in this finite simple graph today"
    envs = environments([r"\newtheorem{claim}{Claim}\begin{proof}Consider the graph. \begin{claim}" + claim
                         + r"\end{claim} Then we are done by counting edges twice.\end{proof}"])
    block = {"block_id": "c", "weak_label": "theorem", "text_without_heading": claim}
    rows = audit_blocks([block], envs)[1]
    assert rows[0]["method"] == "nested" and rows[0]["source_label"] == "theorem"
    short = environments([r"\begin{lemma}The function $\exp$ is continuous and bounded on $X$.\end{lemma}"])
    rows = audit_blocks([{"block_id": "s", "weak_label": "theorem",
                          "text_without_heading": "The function exp is continuous and bounded on X ."}], short)[1]
    assert rows[0]["method"] == "short"
    long = environments([r"\begin{definition}A graph is called bipartite when its vertex set splits into "
                         r"two parts $A$ and $B$ with every edge joining $A$ to $B$.\end{definition}"])
    pdf = "A graph is called bipartite exactly when its vertex set splits into precisely two parts A and B with every edge always joining"
    rows = audit_blocks([{"block_id": "o", "weak_label": "definition", "text_without_heading": pdf}], long)[1]
    assert rows[0]["method"] == "overlap" and rows[0]["source_label"] == "definition"


def test_audit_does_not_match_only_the_appended_proof():
    body = "First " * 40 + "A mapping between these mathematical sets preserves every algebraic operation naturally"
    envs = environments([r"\begin{proof}" + body[240:] + r"\end{proof}"])
    counts, rows = audit_blocks([{"block_id": "mixed", "weak_label": "theorem", "text_without_heading": body}], envs)
    assert counts["unresolved"] == 1 and not rows


def test_truncated_gzip_footer_is_rejected_even_with_readable_tex():
    payload = gzip.compress(b"\\begin{definition}Readable prefix\\end{definition}")
    with pytest.raises(EOFError):
        read_tex(payload[:-8])


def test_complete_gzip_tex_is_read():
    assert read_tex(gzip.compress(b"\\begin{definition}Complete source\\end{definition}")) == [
        "\\begin{definition}Complete source\\end{definition}"]


@pytest.mark.parametrize("status,declared,reject", [(206, "3", True), (200, "9", True), (200, "3", False)])
def test_download_integrity_before_caching(tmp_path, monkeypatch, status, declared, reject):
    monkeypatch.setattr(arxiv_corpus, "ROOT", tmp_path)
    class Response:
        headers = {"Content-Length": declared}
        def __init__(self):
            self.status = status
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self, limit):
            return b"abc"
    monkeypatch.setattr(arxiv_corpus.urllib.request, "urlopen", lambda *args, **kwargs: Response())
    client = arxiv_corpus.Client()
    if reject:
        with pytest.raises(ValueError):
            client.get("https://export.arxiv.org/mock")
    else:
        assert client.get("https://export.arxiv.org/mock") == b"abc"


def test_corrupt_source_is_unresolved_not_dropped_from_audit(tmp_path, monkeypatch):
    from ml.eval import latex_audit
    root = tmp_path / "ml" / "out" / "arxiv_expansion"
    root.mkdir(parents=True)
    (root.parent.parent / "results").mkdir()
    monkeypatch.setattr(latex_audit, "ROOT", root)
    (root / "manifest.json").write_text(json.dumps([{"id": "2501.00001v1", "category": "math.CO"}]))
    (root / "2501.00001v1.source").write_bytes(gzip.compress(b"\\begin{definition}partial source")[:-8])
    (root / "2501.00001v1.blocks.jsonl").write_text(json.dumps({"block_id": "a", "weak_label": "definition",
        "text_without_heading": "A mathematical object has a sufficiently long defining property."}) + "\n")
    latex_audit.main()
    report = json.loads((root / "latex_audit.json").read_text())
    assert report["counts"]["automatic_labels"] == report["counts"]["unresolved"] == 1
    assert report["readable_sources"] == 0 and report["status"] == "partial"
    assert report["papers"][0]["source_error"].startswith("EOFError:")


@pytest.mark.parametrize("quarantined", [False, True])
def test_missing_or_quarantined_source_stays_in_fixed_sample(tmp_path, monkeypatch, quarantined):
    from ml.eval import latex_audit
    root = tmp_path / "ml" / "out" / "arxiv_expansion"
    root.mkdir(parents=True)
    (root.parent.parent / "results").mkdir()
    monkeypatch.setattr(latex_audit, "ROOT", root)
    (root / "manifest.json").write_text(json.dumps([{"id": "2501.00001v1", "category": "math.CO"}]))
    if quarantined:
        (root / "2501.00001v1.source.invalid-1").write_bytes(b"broken source retained")
    (root / "2501.00001v1.blocks.jsonl").write_text(json.dumps({"block_id": "a", "weak_label": "definition",
        "text_without_heading": "A mathematical object has a sufficiently long defining property."}) + "\n")
    latex_audit.main()
    report = json.loads((root / "latex_audit.json").read_text())
    assert report["selected_papers"] == 1 and report["papers_with_sources"] == int(quarantined)
    assert report["counts"]["automatic_labels"] == report["counts"]["unresolved"] == 1
    assert report["alignment_coverage"] == 0 and report["readable_sources"] == 0


def test_fixed_audit_sample_is_category_round_robin():
    papers = [{"id": f"{category}-{rank}", "category": category}
              for category in arxiv_corpus.CATEGORIES for rank in range(4)]
    sample = arxiv_corpus.audit_selection(papers)
    assert len(sample) == 20
    assert [p["category"] for p in sample[:6]] == list(arxiv_corpus.CATEGORIES)
    assert all(p["id"].endswith("-0") for p in sample[:6])


def test_manual_download_list_preserves_version_and_cache_path(tmp_path, monkeypatch):
    monkeypatch.setattr(arxiv_corpus, "ROOT", tmp_path)
    papers = [{"id": "2501.00001v2", "category": "math.CO", "title": "Fixture paper",
               "source_url": "https://export.arxiv.org/e-print/2501.00001v2"}]
    target = arxiv_corpus.write_audit_download_list(papers, size=1)
    item = json.loads(target.read_text())[0]
    assert item["id"] == "2501.00001v2"
    assert item["needed"] is True
    assert item["abstract_url"].endswith("2501.00001v2")
    assert item["save_as"] == str((tmp_path / "2501.00001v2.source").resolve())


@pytest.mark.parametrize("name", ["../evil.tex", "/evil.tex", "..\\evil.tex"])
def test_unsafe_source_archive_rejected(name):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        member = tarfile.TarInfo(name)
        member.size = 1
        archive.addfile(member, io.BytesIO(b"x"))
    with pytest.raises(ValueError):
        read_tex(stream.getvalue())
