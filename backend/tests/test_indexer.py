import hashlib
import io
from pathlib import Path
from unittest.mock import MagicMock

import chromadb
import pytest
from PIL import Image


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@pytest.fixture
def media_root(tmp_path):
    """Creates a self-contained data tree under tmp_path and patches config to use it."""
    data_dir = tmp_path / "data"
    media_dir = data_dir / "media"
    thumbs_dir = data_dir / "thumbnails"
    media_dir.mkdir(parents=True)
    thumbs_dir.mkdir(parents=True)
    img = Image.new("RGB", (10, 10), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    (media_dir / "photo.jpg").write_bytes(buf.getvalue())
    return tmp_path


@pytest.fixture
def mock_services(media_root, monkeypatch):
    import config
    monkeypatch.setattr(config, "DATA_DIR", media_root / "data")
    monkeypatch.setattr(config, "MEDIA_DIR", media_root / "data" / "media")
    monkeypatch.setattr(config, "THUMBS_DIR", media_root / "data" / "thumbnails")

    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)
    monkeypatch.setattr("services.gemini.embed_content", lambda data, mime: [0.1] * 3072)
    monkeypatch.setattr("services.metadata.extract", lambda path: {})
    return {"content": content_col, "data_dir": media_root / "data"}


def test_index_file_upserts_content_collection(media_root, mock_services):
    from services.chroma import get_id_by_hash
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=False)
    assert get_id_by_hash(_sha256(photo)) is not None


def test_index_file_skips_already_indexed(media_root, mock_services, monkeypatch):
    from services.chroma import upsert_content
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    content_hash = _sha256(photo)
    upsert_content(
        "existing-uuid", [0.1] * 3072, "media/photo.jpg", "photo.jpg",
        "image/jpeg", "image", extra_metadata={"content_hash": content_hash},
    )
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file(photo, force=False)
    embed_mock.assert_not_called()


def test_index_file_force_reindexes_existing(media_root, mock_services, monkeypatch):
    from services.chroma import upsert_content
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    content_hash = _sha256(photo)
    upsert_content(
        "existing-uuid", [0.1] * 3072, "media/photo.jpg", "photo.jpg",
        "image/jpeg", "image", extra_metadata={"content_hash": content_hash},
    )
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file(photo, force=True)
    embed_mock.assert_called_once()


def test_index_file_skips_unsupported_extension(media_root, mock_services, monkeypatch):
    (media_root / "data" / "media" / "icon.svg").write_text("<svg/>")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    from services.indexer import index_file
    index_file(media_root / "data" / "media" / "icon.svg", force=False)
    embed_mock.assert_not_called()


def test_index_file_outside_data_dir_is_rejected(media_root, mock_services, tmp_path):
    outside = tmp_path / "elsewhere" / "photo.jpg"
    outside.parent.mkdir(parents=True)
    img = Image.new("RGB", (10, 10))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    outside.write_bytes(buf.getvalue())
    from services.indexer import index_file
    from services.chroma import get_id_by_hash
    index_file(outside, force=False)
    assert get_id_by_hash(_sha256(outside)) is None


def test_run_indexes_all_files_in_media_dir(media_root, mock_services):
    from services.chroma import get_id_by_hash
    from services.indexer import run
    run(force=False)
    photo = media_root / "data" / "media" / "photo.jpg"
    assert get_id_by_hash(_sha256(photo)) is not None


def test_index_file_stores_thumbnail_path_in_metadata(media_root, mock_services):
    from services.chroma import get_id_by_hash
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=False)
    item_id = get_id_by_hash(_sha256(photo))
    result = mock_services["content"].get(ids=[item_id], include=["metadatas"])
    meta = result["metadatas"][0]
    assert "thumbnail_path" in meta
    assert meta["thumbnail_path"].endswith(".webp")
    assert meta["thumbnail_path"].startswith("thumbnails/")


def test_index_file_writes_thumbnail_webp_to_disk(media_root, mock_services):
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=True)
    thumbs = list((media_root / "data" / "thumbnails").glob("*.webp"))
    assert len(thumbs) == 1


def test_index_file_force_overwrites_thumbnail(media_root, mock_services):
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=True)
    index_file(photo, force=True)
    thumbs = list((media_root / "data" / "thumbnails").glob("*.webp"))
    assert len(thumbs) == 1  # overwritten, not duplicated


def test_index_file_stores_extracted_metadata(media_root, mock_services, monkeypatch):
    monkeypatch.setattr(
        "services.indexer.metadata_svc.extract",
        lambda path: {"EXIF_Make": "Nikon", "geo_city": "Paris", "geo_country": "France"},
    )
    from services.chroma import get_id_by_hash
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=True)
    item_id = get_id_by_hash(_sha256(photo))
    result = mock_services["content"].get(ids=[item_id], include=["metadatas"])
    meta = result["metadatas"][0]
    assert meta["EXIF_Make"] == "Nikon"
    assert meta["geo_city"] == "Paris"
    assert meta["geo_country"] == "France"


def test_index_file_stores_relative_path(media_root, mock_services):
    from services.chroma import get_id_by_hash
    from services.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=False)
    item_id = get_id_by_hash(_sha256(photo))
    result = mock_services["content"].get(ids=[item_id], include=["metadatas"])
    meta = result["metadatas"][0]
    assert meta["path"] == "media/photo.jpg"
    assert not meta["path"].startswith("/")
