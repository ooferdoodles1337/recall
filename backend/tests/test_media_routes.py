import io

import pytest
from fastapi import HTTPException
from PIL import Image


def _webp_file(tmp_path) -> str:
    img = Image.new("RGB", (100, 80), color=(100, 150, 200))
    buf = io.BytesIO()
    img.save(buf, format="WEBP")
    p = tmp_path / "thumb.webp"
    p.write_bytes(buf.getvalue())
    return str(p)


def test_thumbnail_404_unknown_id(monkeypatch):
    from routes.media import serve_thumbnail

    monkeypatch.setattr("services.catalog.db.get_item", lambda item_id: None)

    with pytest.raises(HTTPException) as exc:
        serve_thumbnail("does-not-exist")
    assert exc.value.status_code == 404


def test_thumbnail_404_no_thumbnail_path(monkeypatch):
    from routes.media import serve_thumbnail

    monkeypatch.setattr(
        "services.catalog.db.get_item",
        lambda item_id: {"id": item_id, "metadata": {}},
    )

    with pytest.raises(HTTPException) as exc:
        serve_thumbnail("test-uuid")
    assert exc.value.status_code == 404


def test_thumbnail_404_file_missing_from_disk(monkeypatch):
    from routes.media import serve_thumbnail

    monkeypatch.setattr(
        "services.catalog.db.get_item",
        lambda item_id: {"id": item_id, "metadata": {"asset": {"paths": {"thumbnail": "/nonexistent/path.webp"}}}},
    )

    with pytest.raises(HTTPException) as exc:
        serve_thumbnail("test-uuid")
    assert exc.value.status_code == 404


def test_thumbnail_200_returns_webp(monkeypatch, tmp_path):
    from routes.media import serve_thumbnail

    thumb_path = _webp_file(tmp_path)
    monkeypatch.setattr("config.DATA_DIR", tmp_path)
    monkeypatch.setattr(
        "services.catalog.db.get_item",
        lambda item_id: {"id": item_id, "metadata": {"asset": {"paths": {"thumbnail": thumb_path}}}},
    )

    response = serve_thumbnail("test-uuid")

    assert response.media_type == "image/webp"
    assert str(response.path) == thumb_path


def test_display_404_unknown_id(monkeypatch):
    from routes.media import serve_display

    monkeypatch.setattr("services.catalog.db.get_item", lambda item_id: None)

    with pytest.raises(HTTPException) as exc:
        serve_display("does-not-exist")
    assert exc.value.status_code == 404


def test_display_404_no_display_path(monkeypatch):
    from routes.media import serve_display

    monkeypatch.setattr(
        "services.catalog.db.get_item",
        lambda item_id: {"id": item_id, "metadata": {"asset": {"paths": {"thumbnail": "t.webp"}}}},
    )

    with pytest.raises(HTTPException) as exc:
        serve_display("test-uuid")
    assert exc.value.status_code == 404


def test_display_200_returns_webp(monkeypatch, tmp_path):
    from routes.media import serve_display

    display_path = _webp_file(tmp_path)
    monkeypatch.setattr("config.DATA_DIR", tmp_path)
    monkeypatch.setattr(
        "services.catalog.db.get_item",
        lambda item_id: {"id": item_id, "metadata": {"asset": {"paths": {"display": display_path}}}},
    )

    response = serve_display("test-uuid")

    assert response.media_type == "image/webp"
    assert str(response.path) == display_path


def test_thumbnail_rejects_path_outside_data_dir(monkeypatch, tmp_path):
    from routes.media import serve_thumbnail

    outside = tmp_path / "outside.webp"
    outside.write_bytes(b"fake")
    monkeypatch.setattr("config.DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(
        "services.catalog.db.get_item",
        lambda item_id: {"id": item_id, "metadata": {"asset": {"paths": {"thumbnail": str(outside)}}}},
    )

    with pytest.raises(HTTPException) as exc:
        serve_thumbnail("test-uuid")

    assert exc.value.status_code == 404
