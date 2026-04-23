import io
from pathlib import Path
from unittest.mock import MagicMock

import chromadb
import pytest
from PIL import Image


@pytest.fixture
def media_root(tmp_path):
    """Creates tmp_path/data/media/photo.jpg, returns tmp_path as project root."""
    media = tmp_path / "data" / "media"
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
    return {"content": content_col}


def test_index_file_upserts_content_collection(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.indexer import index_file
    index_file("data/media/photo.jpg", force=False)
    result = mock_services["content"].get(ids=["data/media/photo.jpg"])
    assert result["ids"] == ["data/media/photo.jpg"]


def test_index_file_skips_already_indexed(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import upsert_content
    from services.indexer import index_file
    file_id = "data/media/photo.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "photo.jpg", "image/jpeg", "image")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file(file_id, force=False)
    embed_mock.assert_not_called()


def test_index_file_force_reindexes_existing(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import upsert_content
    from services.indexer import index_file
    file_id = "data/media/photo.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "photo.jpg", "image/jpeg", "image")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file(file_id, force=True)
    embed_mock.assert_called_once()


def test_index_file_skips_unsupported_extension(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    (media_root / "data" / "media" / "icon.svg").write_text("<svg/>")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    from services.indexer import index_file
    index_file("data/media/icon.svg", force=False)
    embed_mock.assert_not_called()


def test_run_indexes_all_files_in_media_dir(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.indexer import run
    run(force=False)
    result = mock_services["content"].get(ids=["data/media/photo.jpg"])
    assert result["ids"] == ["data/media/photo.jpg"]
