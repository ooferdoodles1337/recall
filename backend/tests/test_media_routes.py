import io

import chromadb
import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def client(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", col)
    monkeypatch.setattr("services.chroma.configure", lambda path=None: None)
    from main import app
    with TestClient(app) as c:
        yield c, col


def _upsert(col, item_id: str, extra: dict | None = None):
    from services.chroma import upsert_content
    upsert_content(
        item_id, [0.1] * 3072, "/tmp/x.jpg", "x.jpg",
        "image/jpeg", "image", extra_metadata=extra,
    )


def _webp_file(tmp_path) -> str:
    img = Image.new("RGB", (100, 80), color=(100, 150, 200))
    buf = io.BytesIO()
    img.save(buf, format="WEBP")
    p = tmp_path / "thumb.webp"
    p.write_bytes(buf.getvalue())
    return str(p)


def test_thumbnail_404_unknown_id(client):
    c, _ = client
    response = c.get("/media/does-not-exist/thumbnail")
    assert response.status_code == 404


def test_thumbnail_404_no_thumbnail_path(client):
    c, col = client
    _upsert(col, "test-uuid")
    response = c.get("/media/test-uuid/thumbnail")
    assert response.status_code == 404


def test_thumbnail_404_file_missing_from_disk(client):
    c, col = client
    _upsert(col, "test-uuid", extra={"thumbnail_path": "/nonexistent/path.webp"})
    response = c.get("/media/test-uuid/thumbnail")
    assert response.status_code == 404


def test_thumbnail_200_returns_webp(client, tmp_path):
    c, col = client
    thumb_path = _webp_file(tmp_path)
    _upsert(col, "test-uuid", extra={"thumbnail_path": thumb_path})
    response = c.get("/media/test-uuid/thumbnail")
    assert response.status_code == 200
    assert "image/webp" in response.headers["content-type"]
    assert len(response.content) > 0
