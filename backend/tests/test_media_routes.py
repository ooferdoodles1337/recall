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

    monkeypatch.setattr("services.catalog.get_item", lambda item_id: None)

    with pytest.raises(HTTPException) as exc:
        serve_thumbnail("does-not-exist")
    assert exc.value.status_code == 404


def test_thumbnail_404_no_thumbnail_path(monkeypatch):
    from routes.media import serve_thumbnail

    monkeypatch.setattr(
        "services.catalog.get_item",
        lambda item_id: {"id": item_id, "metadata": {}},
    )

    with pytest.raises(HTTPException) as exc:
        serve_thumbnail("test-uuid")
    assert exc.value.status_code == 404


def test_thumbnail_404_file_missing_from_disk(monkeypatch):
    from routes.media import serve_thumbnail

    monkeypatch.setattr(
        "services.catalog.get_item",
        lambda item_id: {"id": item_id, "metadata": {"thumbnail_path": "/nonexistent/path.webp"}},
    )

    with pytest.raises(HTTPException) as exc:
        serve_thumbnail("test-uuid")
    assert exc.value.status_code == 404


def test_thumbnail_200_returns_webp(monkeypatch, tmp_path):
    from routes.media import serve_thumbnail

    thumb_path = _webp_file(tmp_path)
    monkeypatch.setattr(
        "services.catalog.get_item",
        lambda item_id: {"id": item_id, "metadata": {"thumbnail_path": thumb_path}},
    )

    response = serve_thumbnail("test-uuid")

    assert response.media_type == "image/webp"
    assert str(response.path) == thumb_path


def test_library_returns_all_image_metadata_sorted_chronologically(monkeypatch):
    from routes.media import get_library

    monkeypatch.setattr(
        "services.catalog.list_library_items",
        lambda media_type=None, order="desc": [
            {
                "id": "new-id",
                "metadata": {
                    "media_type": "image",
                    "taken_sort": "2024-03-18T10:00:00",
                    "taken_at": "2024-03-18T10:00:00",
                    "taken_date": "2024-03-18",
                },
            },
            {
                "id": "old-id",
                "metadata": {
                    "media_type": "image",
                    "taken_sort": "2024-03-17T10:00:00",
                    "taken_at": "2024-03-17T10:00:00",
                    "taken_date": "2024-03-17",
                },
            },
        ],
    )

    body = get_library(media_type="image", order="desc")

    assert body["count"] == 2
    assert [item["id"] for item in body["results"]] == ["new-id", "old-id"]
    assert body["results"][0]["metadata"]["taken_date"] == "2024-03-18"
