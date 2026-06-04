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
    monkeypatch.setattr(config, "CATALOG_DB_PATH", media_root / "data" / "databases" / "catalog.sqlite")

    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.search.chroma.content_collection", content_col)
    import services.catalog.db as catalog
    catalog.configure(str(config.CATALOG_DB_PATH))
    catalog.reset()
    monkeypatch.setattr("services.providers.gemini.embed_content", lambda data, mime: [0.1] * 3072)
    monkeypatch.setattr(
        "services.providers.gemini.embed_content_batch",
        lambda items: {key: [0.1] * 3072 for key, _, _ in items},
    )
    monkeypatch.setattr("services.catalog.extractor.extract", lambda path, **kwargs: {})
    return {"content": content_col, "data_dir": media_root / "data", "catalog": catalog}


def test_index_file_upserts_content_collection(media_root, mock_services):
    from services.catalog.db import get_id_by_hash
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=False)
    item_id = get_id_by_hash(_sha256(photo))
    assert item_id is not None
    result = mock_services["content"].get(ids=[item_id])
    assert result["ids"] == [item_id]


def test_index_file_upserts_catalog_item(media_root, mock_services):
    from services.catalog.db import get_id_by_hash, get_item
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=False)
    item_id = get_id_by_hash(_sha256(photo))
    item = get_item(item_id)
    assert item["metadata"]["asset"]["filename"] == "photo.jpg"
    assert item["metadata"]["asset"]["paths"]["original"] == "media/photo.jpg"
    assert item["metadata"]["system"]["content_hash"] == _sha256(photo)


def test_index_file_skips_already_indexed(media_root, mock_services, monkeypatch):
    from services.catalog.db import upsert_item
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    content_hash = _sha256(photo)
    upsert_item(
        "existing-uuid", "media/photo.jpg", "photo.jpg",
        "image/jpeg", "image", extra_metadata={"content_hash": content_hash},
    )
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.providers.gemini.embed_content", embed_mock)
    index_file(photo, force=False)
    embed_mock.assert_not_called()


def test_index_file_force_reindexes_existing(media_root, mock_services, monkeypatch):
    from services.catalog.db import upsert_item
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    content_hash = _sha256(photo)
    upsert_item(
        "existing-uuid", "media/photo.jpg", "photo.jpg",
        "image/jpeg", "image", extra_metadata={"content_hash": content_hash},
    )
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.providers.gemini.embed_content", embed_mock)
    index_file(photo, force=True)
    embed_mock.assert_called_once()


def test_index_file_skips_unsupported_extension(media_root, mock_services, monkeypatch):
    (media_root / "data" / "media" / "icon.svg").write_text("<svg/>")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.providers.gemini.embed_content", embed_mock)
    from services.pipeline.indexer import index_file
    index_file(media_root / "data" / "media" / "icon.svg", force=False)
    embed_mock.assert_not_called()


def test_index_file_outside_data_dir_is_rejected(media_root, mock_services, tmp_path):
    outside = tmp_path / "elsewhere" / "photo.jpg"
    outside.parent.mkdir(parents=True)
    img = Image.new("RGB", (10, 10))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    outside.write_bytes(buf.getvalue())
    from services.catalog.db import get_id_by_hash
    from services.pipeline.indexer import index_file
    index_file(outside, force=False)
    assert get_id_by_hash(_sha256(outside)) is None


def test_run_indexes_all_files_in_media_dir(media_root, mock_services):
    from services.catalog.db import get_id_by_hash
    from services.pipeline.indexer import run
    run(force=False, annotate=False, detect_nsfw=False)
    photo = media_root / "data" / "media" / "photo.jpg"
    item_id = get_id_by_hash(_sha256(photo))
    assert item_id is not None
    result = mock_services["content"].get(ids=[item_id])
    assert result["ids"] == [item_id]


def test_run_indexes_all_files_in_catalog(media_root, mock_services):
    from services.catalog.db import get_id_by_hash
    from services.pipeline.indexer import run
    run(force=False, annotate=False, detect_nsfw=False)
    photo = media_root / "data" / "media" / "photo.jpg"
    assert get_id_by_hash(_sha256(photo)) is not None


def test_run_splits_embedding_batches_by_jsonl_size(media_root, mock_services, monkeypatch):
    second = media_root / "data" / "media" / "second.jpg"
    Image.new("RGB", (10, 10), color=(0, 0, 255)).save(second, format="JPEG")

    calls = []

    def fake_embed_content_batch(items):
        calls.append([key for key, _, _ in items])
        return {key: [0.1] * 3072 for key, _, _ in items}

    monkeypatch.setattr("services.pipeline.indexer.gemini.embed_content_batch", fake_embed_content_batch)

    from services.pipeline.indexer import run

    run(force=False, annotate=False, detect_nsfw=False, embedding_batch_max_jsonl_bytes=1, embedding_inline_threshold=0)

    assert len(calls) == 2
    assert all(len(call) == 1 for call in calls)


def test_run_skips_duplicate_hashes_within_same_batch(media_root, mock_services, monkeypatch):
    original = media_root / "data" / "media" / "photo.jpg"
    duplicate = media_root / "data" / "media" / "duplicate.jpg"
    duplicate.write_bytes(original.read_bytes())

    embed_mock = MagicMock(return_value={})

    def fake_embed_content_batch(items):
        embed_mock(items)
        return {key: [0.1] * 3072 for key, _, _ in items}

    monkeypatch.setattr("services.pipeline.indexer.gemini.embed_content_batch", fake_embed_content_batch)

    from services.catalog.db import get_all_items_with_metadata
    from services.pipeline.indexer import run

    run(force=False, annotate=False, detect_nsfw=False, embedding_inline_threshold=0)

    assert len(embed_mock.call_args[0][0]) == 1
    assert len(get_all_items_with_metadata()) == 1


def test_run_detect_nsfw_starts_detection_pass(media_root, mock_services, monkeypatch):
    from services.pipeline.indexer import run

    detect_mock = MagicMock()
    monkeypatch.setattr("services.pipeline.nsfw.detect_undetected", detect_mock)

    run(force=False, annotate=False, detect_nsfw=True)

    detect_mock.assert_called_once()


def test_run_skips_unchanged_file_by_stat_before_hashing(media_root, mock_services, monkeypatch):
    from services.pipeline import indexer
    from services.pipeline.indexer import run

    photo = media_root / "data" / "media" / "photo.jpg"
    run(force=False, annotate=False, detect_nsfw=False)

    hash_mock = MagicMock(side_effect=AssertionError("unchanged files should not be hashed"))
    monkeypatch.setattr(indexer, "_file_hash", hash_mock)

    run(force=False, annotate=False, detect_nsfw=False)

    hash_mock.assert_not_called()


def test_run_reuses_embedding_for_renamed_file(media_root, mock_services, monkeypatch):
    from services.catalog.db import get_all_items_with_metadata
    from services.pipeline.indexer import run

    original = media_root / "data" / "media" / "photo.jpg"
    run(force=False, annotate=False, detect_nsfw=False)

    renamed = media_root / "data" / "media" / "renamed.jpg"
    original.rename(renamed)
    embed_mock = MagicMock(return_value={})
    monkeypatch.setattr("services.pipeline.indexer.gemini.embed_content_batch", embed_mock)
    inline_mock = MagicMock(return_value=[0.2] * 3072)
    monkeypatch.setattr("services.pipeline.indexer.gemini.embed_content", inline_mock)

    run(force=False, annotate=False, detect_nsfw=False)

    embed_mock.assert_not_called()
    inline_mock.assert_not_called()
    items = get_all_items_with_metadata()
    assert len(items) == 1
    assert items[0]["metadata"]["asset"]["filename"] == "renamed.jpg"
    assert items[0]["metadata"]["asset"]["paths"]["original"] == "media/renamed.jpg"


def test_classify_file_skips_unchanged_stat_before_hashing(media_root, mock_services, monkeypatch):
    from services.pipeline import indexer

    photo = media_root / "data" / "media" / "photo.jpg"
    size, mtime_ns = indexer._file_stat(photo)
    monkeypatch.setattr(indexer, "_file_hash", MagicMock(side_effect=AssertionError("should not hash")))

    decision = indexer._classify_file(
        photo,
        force=False,
        seen_hashes=set(),
        records_by_path={
            "media/photo.jpg": {
                "id": "existing-id",
                "asset_path": "media/photo.jpg",
                "content_hash": "old-hash",
                "file_size": size,
                "file_mtime_ns": mtime_ns,
            }
        },
        records_by_hash={},
    )

    assert isinstance(decision, indexer._SkipFile)
    assert decision.reason == "unchanged_stat"


def test_classify_file_skips_duplicate_in_current_run(media_root, mock_services):
    from services.pipeline import indexer

    photo = media_root / "data" / "media" / "photo.jpg"
    content_hash = _sha256(photo)

    decision = indexer._classify_file(
        photo,
        force=False,
        seen_hashes={content_hash},
        records_by_path={},
        records_by_hash={},
    )

    assert isinstance(decision, indexer._SkipFile)
    assert decision.reason == "duplicate_in_run"


def test_classify_file_reuses_same_path_same_hash(media_root, mock_services):
    from services.pipeline import indexer

    photo = media_root / "data" / "media" / "photo.jpg"
    content_hash = _sha256(photo)
    size, mtime_ns = indexer._file_stat(photo)

    decision = indexer._classify_file(
        photo,
        force=False,
        seen_hashes=set(),
        records_by_path={
            "media/photo.jpg": {
                "id": "existing-id",
                "asset_path": "media/photo.jpg",
                "content_hash": content_hash,
                "file_size": size,
                "file_mtime_ns": mtime_ns - 1,
            }
        },
        records_by_hash={content_hash: {"id": "existing-id", "asset_path": "media/photo.jpg"}},
    )

    assert isinstance(decision, indexer._ReuseFile)
    assert decision.reason == "same_path_same_hash"
    assert decision.file_id == "existing-id"


def test_classify_file_reuses_moved_or_renamed_file(media_root, mock_services):
    from services.pipeline import indexer

    photo = media_root / "data" / "media" / "photo.jpg"
    content_hash = _sha256(photo)

    decision = indexer._classify_file(
        photo,
        force=False,
        seen_hashes=set(),
        records_by_path={},
        records_by_hash={content_hash: {"id": "existing-id", "asset_path": "media/missing.jpg"}},
    )

    assert isinstance(decision, indexer._ReuseFile)
    assert decision.reason == "moved_or_renamed"
    assert decision.old_rel_path == "media/missing.jpg"


def test_classify_file_skips_cross_path_duplicate_when_original_exists(media_root, mock_services):
    from services.pipeline import indexer

    original = media_root / "data" / "media" / "photo.jpg"
    duplicate = media_root / "data" / "media" / "duplicate.jpg"
    duplicate.write_bytes(original.read_bytes())
    content_hash = _sha256(original)

    decision = indexer._classify_file(
        duplicate,
        force=False,
        seen_hashes=set(),
        records_by_path={},
        records_by_hash={content_hash: {"id": "existing-id", "asset_path": "media/photo.jpg"}},
    )

    assert isinstance(decision, indexer._SkipFile)
    assert decision.reason == "duplicate_content"


def test_run_uses_inline_embedding_for_small_updates(media_root, mock_services, monkeypatch):
    from services.pipeline.indexer import run

    batch_mock = MagicMock(return_value={})
    inline_mock = MagicMock(return_value=[0.3] * 3072)
    monkeypatch.setattr("services.pipeline.indexer.gemini.embed_content_batch", batch_mock)
    monkeypatch.setattr("services.pipeline.indexer.gemini.embed_content", inline_mock)

    run(force=False, annotate=False, detect_nsfw=False, embedding_inline_threshold=4)

    inline_mock.assert_called_once()
    batch_mock.assert_not_called()


def test_index_file_stores_thumbnail_path_in_metadata(media_root, mock_services):
    from services.catalog.db import get_id_by_hash
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=False)
    item_id = get_id_by_hash(_sha256(photo))
    item = mock_services["catalog"].get_item(item_id)
    assert item["metadata"]["asset"]["paths"]["thumbnail"].endswith(".webp")
    assert item["links"]["thumbnail"] == f"/media/{item_id}/thumbnail"


def test_index_file_writes_thumbnail_webp_to_disk(media_root, mock_services):
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=True)
    thumbs = list((media_root / "data" / "thumbnails").glob("*.webp"))
    assert len(thumbs) == 1


def test_index_file_force_overwrites_thumbnail(media_root, mock_services):
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=True)
    index_file(photo, force=True)
    thumbs = list((media_root / "data" / "thumbnails").glob("*.webp"))
    assert len(thumbs) == 1  # overwritten, not duplicated


def test_index_file_stores_extracted_metadata(media_root, mock_services, monkeypatch):
    monkeypatch.setattr(
        "services.pipeline.indexer.metadata_svc.extract",
        lambda path, **kwargs: {"EXIF_Make": "Nikon", "geo_city": "Paris", "geo_country": "France"},
    )
    from services.catalog.db import get_id_by_hash, get_item
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=True)
    item_id = get_id_by_hash(_sha256(photo))
    meta = get_item(item_id)["metadata"]
    assert meta["raw"]["exif"]["EXIF_Make"] == "Nikon"
    assert meta["capture"]["location"]["city"] == "Paris"
    assert meta["capture"]["location"]["country"] == "France"


def test_index_file_stores_relative_path(media_root, mock_services):
    from services.catalog.db import get_id_by_hash
    from services.pipeline.indexer import index_file
    photo = media_root / "data" / "media" / "photo.jpg"
    index_file(photo, force=False)
    item_id = get_id_by_hash(_sha256(photo))
    item = mock_services["catalog"].get_item(item_id)
    path = item["metadata"]["asset"]["paths"]["original"]
    assert path == "media/photo.jpg"
    assert not path.startswith("/")


def test_index_file_stores_original_asset_mime_type(media_root, mock_services):
    from services.catalog.db import get_id_by_hash, get_item
    from services.pipeline.indexer import index_file

    webp = media_root / "data" / "media" / "photo.webp"
    Image.new("RGB", (10, 10), color=(0, 255, 0)).save(webp, format="WEBP")

    index_file(webp, force=False)

    item_id = get_id_by_hash(_sha256(webp))
    meta = get_item(item_id)["metadata"]
    assert meta["asset"]["mime_type"] == "image/webp"
    assert meta["asset"]["media_type"] == "image"
