"""POST /bundle on the RAG service, with a stub pipeline (no trained model)."""

import sys
from pathlib import Path

import pytest

pytest.importorskip("multipart")
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "local-llm" / "rag-api"))
import okf_api  # noqa: E402

from ml.okf.conformance import check  # noqa: E402
from ml.okf.pipeline import Decision  # noqa: E402


class StubPipeline:
    """Marks every block containing 'is called' as a detector definition."""

    def classify(self, blocks, emphasis=None):
        return [Decision(b["block_id"], "definition", True, "detector", 0.9, b["text"], ((b["text"], 0.9),))
                if "is called" in b["text"] else Decision(b["block_id"], "other", False, "classifier", 0.0, None)
                for b in blocks]


def pdf_bytes(tmp_path):
    import pymupdf
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "A graph is called bipartite if its vertices split into two classes.", fontsize=11)
    path = tmp_path / "toy.pdf"
    document.save(path)
    return path.read_bytes()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(okf_api, "get_pipeline", lambda: StubPipeline())
    app = FastAPI()
    app.include_router(okf_api.router)
    return TestClient(app)


def test_bundle_returns_conformant_files(client, tmp_path):
    response = client.post("/bundle", files={"file": ("toy.pdf", pdf_bytes(tmp_path), "application/pdf")},
                           data={"category": "paper"})
    assert response.status_code == 200
    body = response.json()
    paths = {f["path"] for f in body["files"]}
    assert {"index.md", "log.md", "definitions/bipartite.md"} <= paths
    assert body["fileName"] == "toy.pdf" and len(body["fingerprint"]) == 32
    assert body["summary"]["concepts"] == 1
    out = tmp_path / "bundle"
    for item in body["files"]:
        (out / item["path"]).parent.mkdir(parents=True, exist_ok=True)
        (out / item["path"]).write_text(item["content"], encoding="utf-8")
    assert check(out)["conformant"]
    assert f"margin://doc/{body['fingerprint']}/page/1" in (out / "definitions/bipartite.md").read_text(encoding="utf-8")


def test_bundle_rejects_non_pdf_and_unknown_category(client, tmp_path):
    assert client.post("/bundle", files={"file": ("x.pdf", b"hello", "application/pdf")}).status_code == 415
    response = client.post("/bundle", files={"file": ("toy.pdf", pdf_bytes(tmp_path), "application/pdf")},
                           data={"category": "novel"})
    assert response.status_code == 422
