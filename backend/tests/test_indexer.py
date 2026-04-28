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
    """Creates tmp_path/backend/data/media/photo.jpg, returns tmp_path as project root."""
    media = tmp_path / "backend" / "data" / "media"
    media.mkdir(parents=True)
    img = Image.new("RGB", (10, 10), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    (media / "photo.jpg").write_bytes(buf.getvalue())
    return tmp_path


@pytest.fixture
def mock_services(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)
    monkeypatch.setattr("services.gemini.embed_content", lambda data, mime: [0.1] * 3072)
    monkeypatch.setattr("services.metadata.extract", lambda path: {})
    return {"content": content_col}


def test_index_file_upserts_content_collection(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import get_id_by_hash
    from services.indexer import index_file
    index_file("backend/data/media/photo.jpg", force=False)
    content_hash = _sha256(media_root / "backend" / "data" / "media" / "photo.jpg")
    assert get_id_by_hash(content_hash) is not None


def test_index_file_skips_already_indexed(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import upsert_content
    from services.indexer import index_file
    content_hash = _sha256(media_root / "backend" / "data" / "media" / "photo.jpg")
    upsert_content(
        "existing-uuid", [0.1] * 3072, "backend/data/media/photo.jpg", "photo.jpg",
        "image/jpeg", "image", extra_metadata={"content_hash": content_hash},
    )
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file("backend/data/media/photo.jpg", force=False)
    embed_mock.assert_not_called()


def test_index_file_force_reindexes_existing(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import upsert_content
    from services.indexer import index_file
    content_hash = _sha256(media_root / "backend" / "data" / "media" / "photo.jpg")
    upsert_content(
        "existing-uuid", [0.1] * 3072, "backend/data/media/photo.jpg", "photo.jpg",
        "image/jpeg", "image", extra_metadata={"content_hash": content_hash},
    )
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file("backend/data/media/photo.jpg", force=True)
    embed_mock.assert_called_once()


def test_index_file_skips_unsupported_extension(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    (media_root / "backend" / "data" / "media" / "icon.svg").write_text("<svg/>")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    from services.indexer import index_file
    index_file("backend/data/media/icon.svg", force=False)
    embed_mock.assert_not_called()


def test_run_indexes_all_files_in_media_dir(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import get_id_by_hash
    from services.indexer import run
    run(force=False)
    content_hash = _sha256(media_root / "backend" / "data" / "media" / "photo.jpg")
    assert get_id_by_hash(content_hash) is not None


def test_index_file_stores_thumbnail_path_in_metadata(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import get_id_by_hash
    from services.indexer import index_file
    index_file("backend/data/media/photo.jpg", force=False)
    content_hash = _sha256(media_root / "backend" / "data" / "media" / "photo.jpg")
    item_id = get_id_by_hash(content_hash)
    result = mock_services["content"].get(ids=[item_id], include=["metadatas"])
    meta = result["metadatas"][0]
    assert "thumbnail_path" in meta
    assert meta["thumbnail_path"].endswith(".webp")


def test_index_file_writes_thumbnail_webp_to_disk(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.indexer import index_file
    # force=True ensures the thumbnail write path is exercised regardless of shared
    # EphemeralClient state between tests (ChromaDB EphemeralClient shares in-process state)
    index_file("backend/data/media/photo.jpg", force=True)
    thumbnails = list((media_root / "backend" / "data" / "thumbnails").glob("*.webp"))
    assert len(thumbnails) == 1


def test_index_file_force_overwrites_thumbnail(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.indexer import index_file
    index_file("backend/data/media/photo.jpg", force=True)
    thumbnails_before = list((media_root / "backend" / "data" / "thumbnails").glob("*.webp"))
    assert len(thumbnails_before) == 1
    index_file("backend/data/media/photo.jpg", force=True)
    thumbnails_after = list((media_root / "backend" / "data" / "thumbnails").glob("*.webp"))
    assert len(thumbnails_after) == 1  # still one — overwritten, not duplicated


def test_index_file_stores_extracted_metadata(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    monkeypatch.setattr(
        "services.indexer.metadata_svc.extract",
        lambda path: {"EXIF_Make": "Nikon", "geo_city": "Paris", "geo_country": "France"},
    )
    from services.chroma import get_id_by_hash
    from services.indexer import index_file
    index_file("backend/data/media/photo.jpg", force=True)
    content_hash = _sha256(media_root / "backend" / "data" / "media" / "photo.jpg")
    item_id = get_id_by_hash(content_hash)
    result = mock_services["content"].get(ids=[item_id], include=["metadatas"])
    meta = result["metadatas"][0]
    assert meta["EXIF_Make"] == "Nikon"
    assert meta["geo_city"] == "Paris"
    assert meta["geo_country"] == "France"
