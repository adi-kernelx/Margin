"""ML3 OKF bundle writer and conformance checker (toy blocks, no trained model)."""

import yaml

from ml.okf.bundle import (build_concepts, defined_symbol, defined_term, headed_definition_term, link_concepts, pdf_fingerprint,
                           render, render_index)
from ml.okf.conformance import check
from ml.okf.pipeline import Decision

BOX = {"x0": 0.1, "y0": 0.2, "x1": 0.9, "y1": 0.3}


def block(block_id, page, text, weak=None, subtype=None, number=None, name=None, heading=None):
    body = text if not heading else text[len(heading):].strip()
    return {"block_id": block_id, "page": page, "bbox": BOX, "text": text, "text_without_heading": body,
            "weak_label": weak, "weak_subtype": subtype, "heading_number": number, "heading_name": name,
            "heading_text": heading}


def toy():
    blocks = [
        block("d1", 1, "Definition 2.1. A plane tree is a subset t of U with a root.", "definition", "definition",
              "2.1", None, "Definition 2.1."),
        block("p1", 2, "A graph is called bipartite if its vertices split into two classes."),
        block("t1", 3, "Theorem 3.4. Every bipartite graph with a plane tree has property P, by Definition 2.1.",
              "theorem", "theorem", "3.4", None, "Theorem 3.4."),
        block("pr", 3, "Proof. Follows from Definition 2.1.", "proof", "proof", None, None, "Proof."),
        block("n1", 4, "Let F denote the distribution function of X."),
        block("r1", 5, "Smith et al. (2020). The mathematics of trees. Journal of Trees."),
        block("p2", 6, "A graph is called bipartite if it has no odd cycle."),
    ]
    decisions = [
        Decision("d1", "definition", True, "heading", 1.0, None),
        Decision("p1", "definition", True, "detector", 0.9, blocks[1]["text"], ((blocks[1]["text"], 0.9),)),
        Decision("t1", "theorem", False, "heading", 1.0, None),
        Decision("pr", "proof", False, "heading", 1.0, None),
        Decision("n1", "definition", True, "detector", 0.7, blocks[4]["text"], ((blocks[4]["text"], 0.7),)),
        Decision("r1", "definition", True, "detector", 0.5, blocks[5]["text"], ((blocks[5]["text"], 0.5),)),
        Decision("p2", "definition", True, "detector", 0.8, blocks[6]["text"], ((blocks[6]["text"], 0.8),)),
    ]
    emphasis = {"d1": ["plane tree", "root"], "p1": ["bipartite"]}
    return blocks, decisions, emphasis


def test_term_extraction():
    assert defined_term("A graph is called bipartite if it splits.", []) == "bipartite"
    assert defined_term("We call a binary tree t an agreement subtree of t and s if it fits.", []) == "agreement subtree"
    assert defined_term("Let us denote by T a common subtree.", []) is None
    assert defined_term("Let F denote the distribution function.", []) is None
    assert defined_symbol("Let F denote the distribution function.") == "F"
    assert defined_term("Then: the bound holds.", []) is None
    assert defined_term("See Section 5 where the tree is called special.", ["Section 5", "special"]) == "special"
    assert headed_definition_term("A plane tree is a subset; the vertex is called the root.",
                                  ["plane tree", "root"]) == "plane tree"


def test_concepts_types_titles_proofs_and_filters():
    blocks, decisions, emphasis = toy()
    concepts = build_concepts(blocks, decisions, emphasis, "toy.pdf", "abc123", "2026-10-14T00:00:00Z")
    titles = [(c["frontmatter"]["type"], c["title"]) for c in concepts]
    assert titles == [("Definition", "Definition 2.1 (plane tree)"), ("Definition", "bipartite"),
                      ("Theorem", "Theorem 3.4"), ("Notation", "F")]
    theorem = concepts[2]
    assert theorem["proof_pages"] == [3]
    assert concepts[1]["frontmatter"]["resource"] == "margin://doc/abc123/page/2#bbox=0.1000,0.2000,0.9000,0.3000"
    assert all(c["frontmatter"]["status"] == "draft" and "verified" not in c["frontmatter"] for c in concepts)


def test_links_from_references_and_specific_terms():
    blocks, decisions, emphasis = toy()
    concepts = build_concepts(blocks, decisions, emphasis, "toy.pdf", "abc123", "2026-10-14T00:00:00Z")
    link_concepts(concepts)
    theorem = next(c for c in concepts if c["title"] == "Theorem 3.4")
    assert ("definitions/definition-2-1.md", "Definition 2.1 (plane tree)") in theorem["uses"]
    assert ("definitions/bipartite.md", "bipartite") in theorem["uses"]


def test_written_bundle_is_conformant_and_frontmatter_round_trips(tmp_path):
    blocks, decisions, emphasis = toy()
    concepts = build_concepts(blocks, decisions, emphasis, "toy.pdf", "abc123", "2026-10-14T00:00:00Z")
    link_concepts(concepts)
    for concept in concepts:
        path = tmp_path / concept["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render(concept), encoding="utf-8")
    (tmp_path / "index.md").write_text(render_index(concepts, "toy.pdf"), encoding="utf-8")
    (tmp_path / "log.md").write_text("# 2026-10-14\n\n**Creation** test\n", encoding="utf-8")
    report = check(tmp_path)
    assert report["conformant"] and report["concepts"] == 4 and not report["warnings"]
    front = yaml.safe_load((tmp_path / "definitions/bipartite.md").read_text(encoding="utf-8").split("---\n")[1])
    assert front["generated"]["by"].startswith("margin-okf/") and front["margin"]["method"] == "detector"


def test_conformance_catches_missing_type_and_bad_index(tmp_path):
    (tmp_path / "a.md").write_text("---\ntitle: x\n---\nbody\n", encoding="utf-8")
    (tmp_path / "b.md").write_text("no frontmatter\n", encoding="utf-8")
    (tmp_path / "index.md").write_text("---\ntitle: nope\n---\nplain text\n", encoding="utf-8")
    errors = check(tmp_path)["errors"]
    assert any("a.md: missing or empty type" in e for e in errors)
    assert any("b.md: missing frontmatter" in e for e in errors)
    assert sum("index.md" in e for e in errors) == 2


def test_fingerprint_matches_pdfjs_rule(tmp_path):
    import pymupdf
    path = tmp_path / "x.pdf"
    document = pymupdf.open()
    document.new_page()
    document.save(path)
    fingerprint = pdf_fingerprint(path)
    assert len(fingerprint) == 32 and fingerprint == fingerprint.lower()


def test_reserved_names_never_become_concept_files():
    from ml.okf.bundle import slug
    assert slug("Index") == "index-concept" and slug("log") == "log-concept" and slug("logic") == "logic"


def test_emphasis_needs_a_defining_position_and_headings_are_not_terms():
    assert defined_term("The Internet: a “nuts and bolts” view", ["Internet"]) is None
    assert defined_term("We now show that the DFP algorithm is a quasi-Newton method", ["DFP"]) is None
    assert defined_term("The Theory: What are Continuous Variables?", []) is None
    assert defined_term("A shared secret key is a cryptographic key.", ["shared secret key"]) == "shared secret key"
    assert defined_term("a suitable penalty function α is defined by α ( x ) = 1", ["penalty function"]) == \
        "penalty function"
    assert defined_term("§ A polytree is a directed graph with no undirected cycles", []) == "polytree"
    assert defined_term("Definition: A Naive Bayes classifier is a probabilistic model.", []) == "Naive Bayes classifier"
    assert defined_term("b) e-CNY (China): E-CNY, or digital yuan, is China’s digital currency.", []) == "e-CNY"
    assert defined_term("We call ( x , y ) the active bounds at stage i .", []) == "active bounds"
    assert defined_term("We refer to the function f ( x ) as the auxiliary function .", []) == "auxiliary function"


def test_symbols_and_gists():
    from ml.okf.bundle import statement_gist
    assert defined_symbol("The incremented value is denoted as ‘cbOtcn’ (16).") == "cbOtcn"
    assert defined_symbol("where Q ( Y ) denotes sufficient statistic") == "Q(Y)"
    assert statement_gist("ACQ holds at x if the cones agree.") == "ACQ"
    assert statement_gist("Let A be a matrix. Then, N ( A ) is closed .") == "N ( A ) is closed"


def test_links_skip_same_block_and_nested_terms():
    blocks = [block("a", 1, "The lower level set is defined by L = {x : f(x) <= a}."),
              block("b", 1, "The level set is defined by L = {x : f(x) = a}."),
              block("c", 2, "Every lower level set of a convex function is convex.")]
    decisions = [Decision(b["block_id"], "definition", True, "detector", 0.9, b["text"], ((b["text"], 0.9),))
                 for b in blocks[:2]] + [Decision("c", "other", False, "classifier", 0.0, None)]
    concepts = build_concepts(blocks, decisions, {}, "toy.pdf", "abc", "2026-10-14T00:00:00Z")
    link_concepts(concepts)
    assert [c["title"] for c in concepts] == ["lower level set", "level set"]
    assert concepts[0]["uses"] == []          # "level set" inside "lower level set" is not a use


def test_headed_name_suppresses_prose_restatement_and_symbols_dedupe():
    blocks = [block("p", 1, "Formally, we define a penalty function in next slide."),
              block("h", 2, "Definition (penalty function) A function P is called a penalty function if P >= 0.",
                    "definition", "definition", None, None, "Definition (penalty function)"),
              block("s1", 3, "The transaction number, denoted as ‘cbRt’, is recorded as 0."),
              block("s2", 4, "The transaction number, denoted as ‘cbRt’, is recorded as 0 again."),
              block("u", 5, "Every penalty function is nonnegative.")]
    decisions = [Decision(b["block_id"], "definition", True, "detector", 0.9, b["text"], ((b["text"], 0.9),))
                 for b in (blocks[0],)] + [Decision("h", "definition", True, "heading", 1.0, None)] + \
                [Decision(b["block_id"], "definition", True, "detector", 0.9, b["text"], ((b["text"], 0.9),))
                 for b in blocks[2:4]] + [Decision("u", "other", False, "classifier", 0.0, None)]
    concepts = build_concepts(blocks, decisions, {}, "toy.pdf", "abc", "2026-10-14T00:00:00Z")
    assert [c["title"] for c in concepts] == ["Definition (penalty function)", "cbRt"]
    concepts[1]["body"] += " A penalty function is used."
    link_concepts(concepts)
    assert concepts[1]["uses"] == [(concepts[0]["path"], "Definition (penalty function)")]
