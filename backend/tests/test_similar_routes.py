import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from services.pipeline.media import ProcessedFile


@pytest.fixture
def client():
    from routes import search
    app = FastAPI()
    app.include_router(search.router)
    return TestClient(app)


def _fake_search(ids, distances=None):
    if distances is None:
        distances = [float(i) * 0.1 for i in range(len(ids))]
    return {"ids": [ids], "distances": [distances]}


def _jpeg_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(200, 100, 50)).save(buf, format="JPEG")
    return buf.getvalue()


# ── GET /similar/{id} ──────────────────────────────────────────────────────────

def test_similar_by_id_returns_results(monkeypatch):
    from routes.search import search_similar_by_id

    monkeypatch.setattr("services.search.chroma.get_embedding", lambda id: [0.1] * 3072)
    monkeypatch.setattr("services.search.chroma.search", lambda emb, n_results: _fake_search(["a", "b"]))
    monkeypatch.setattr(
        "services.catalog.db.get_item_summary",
        lambda id: {"id": id, "metadata": {"filename": f"{id}.jpg"}},
    )

    result = search_similar_by_id("query-id", n=5)

    assert result["query_id"] == "query-id"
    assert len(result["results"]) == 2
    assert {r["id"] for r in result["results"]} == {"a", "b"}


def test_similar_by_id_excludes_self(monkeypatch):
    from routes.search import search_similar_by_id

    monkeypatch.setattr("services.search.chroma.get_embedding", lambda id: [0.1] * 3072)
    monkeypatch.setattr(
        "services.search.chroma.search",
        lambda emb, n_results: _fake_search(["query-id", "other"]),
    )
    monkeypatch.setattr(
        "services.catalog.db.get_item_summary",
        lambda id: {"id": id, "metadata": {}},
    )

    result = search_similar_by_id("query-id", n=5)

    assert all(r["id"] != "query-id" for r in result["results"])
    assert any(r["id"] == "other" for r in result["results"])


def test_similar_by_id_404_when_not_in_chroma(monkeypatch):
    from fastapi import HTTPException
    from routes.search import search_similar_by_id

    monkeypatch.setattr("services.search.chroma.get_embedding", lambda id: None)

    with pytest.raises(HTTPException) as exc:
        search_similar_by_id("missing-id")
    assert exc.value.status_code == 404


def test_similar_by_id_respects_n_limit(monkeypatch):
    from routes.search import search_similar_by_id

    monkeypatch.setattr("services.search.chroma.get_embedding", lambda id: [0.1] * 3072)
    monkeypatch.setattr(
        "services.search.chroma.search",
        lambda emb, n_results: _fake_search(["a", "b", "c", "d"]),
    )
    monkeypatch.setattr(
        "services.catalog.db.get_item_summary",
        lambda id: {"id": id, "metadata": {}},
    )

    result = search_similar_by_id("query-id", n=2)

    assert len(result["results"]) <= 2


# ── POST /similar ──────────────────────────────────────────────────────────────

def test_similar_upload_returns_results(client, monkeypatch):
    monkeypatch.setattr(
        "services.pipeline.media.process_image",
        lambda path: ProcessedFile(data=b"img", mime_type="image/jpeg", media_type="image"),
    )
    monkeypatch.setattr("services.providers.gemini.embed_content", lambda data, mime: [0.1] * 3072)
    monkeypatch.setattr(
        "services.search.chroma.search",
        lambda emb, n_results: _fake_search(["result-1"]),
    )
    monkeypatch.setattr(
        "services.catalog.db.get_item_summary",
        lambda id: {"id": id, "metadata": {"filename": "result.jpg"}},
    )

    response = client.post(
        "/similar",
        files={"file": ("photo.jpg", _jpeg_bytes(), "image/jpeg")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["query_filename"] == "photo.jpg"
    assert len(data["results"]) == 1
    assert data["results"][0]["id"] == "result-1"


def test_similar_upload_rejects_video(client):
    response = client.post(
        "/similar",
        files={"file": ("clip.mp4", b"fakevideo", "video/mp4")},
    )
    assert response.status_code == 415


def test_similar_upload_rejects_oversized(client, monkeypatch):
    monkeypatch.setattr("routes.search._MAX_UPLOAD_BYTES", 10)

    response = client.post(
        "/similar",
        files={"file": ("big.jpg", b"x" * 11, "image/jpeg")},
    )
    assert response.status_code == 413


def test_similar_upload_passes_through_processing_pipeline(client, monkeypatch):
    """Verifies upload bytes reach process_image and embedding is taken from its output."""
    processed_mime = []
    embedded_data = []

    def fake_process(path):
        return ProcessedFile(data=b"processed-bytes", mime_type="image/png", media_type="image")

    def fake_embed(data, mime):
        processed_mime.append(mime)
        embedded_data.append(data)
        return [0.2] * 3072

    monkeypatch.setattr("services.pipeline.media.process_image", fake_process)
    monkeypatch.setattr("services.providers.gemini.embed_content", fake_embed)
    monkeypatch.setattr("services.search.chroma.search", lambda emb, n_results: _fake_search([]))
    monkeypatch.setattr("services.catalog.db.get_item_summary", lambda id: None)

    client.post("/similar", files={"file": ("img.png", b"rawbytes", "image/png")})

    assert processed_mime == ["image/png"]
    assert embedded_data == [b"processed-bytes"]
