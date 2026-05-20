import io

import chromadb
import pytest
from PIL import Image

TEST_UUID = "aaaaaaaa-0000-0000-0000-000000000003"


@pytest.fixture(autouse=True)
def in_memory_catalog(tmp_path, monkeypatch):
    import config
    import services.catalog.db as catalog

    data_dir = tmp_path / "data"
    media_dir = data_dir / "media"
    thumbs_dir = data_dir / "thumbnails"
    media_dir.mkdir(parents=True)
    thumbs_dir.mkdir(parents=True)
    monkeypatch.setattr(config, "DATA_DIR", data_dir)

    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.search.chroma.content_collection", content_col)

    catalog.configure(str(tmp_path / "catalog.sqlite"))
    catalog.reset()
    return data_dir


def _write_jpeg(path):
    image = Image.new("RGB", (10, 10), color=(255, 0, 0))
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    path.write_bytes(buf.getvalue())


def _seed(extra=None, media_type="image"):
    import services.catalog.db as catalog

    metadata = {"content_hash": f"test-hash-{TEST_UUID}"}
    if extra:
        metadata.update(extra)
    catalog.upsert_item(
        file_id=TEST_UUID,
        path="media/foo.jpg",
        filename="foo.jpg",
        mime_type="image/jpeg",
        media_type=media_type,
        extra_metadata=metadata,
    )


def test_detect_undetected_writes_nsfw_metadata(in_memory_catalog, monkeypatch):
    import services.catalog.db as catalog
    from services.pipeline import nsfw

    _write_jpeg(in_memory_catalog / "media" / "foo.jpg")
    _seed()
    monkeypatch.setattr(
        nsfw,
        "detect_image",
        lambda path: {"model": nsfw.MODEL_NAME, "nsfw_score": 0.95, "state": "nsfw"},
    )

    nsfw.detect_undetected()

    safety = catalog.get_item(TEST_UUID)["metadata"]["safety"]
    assert safety["state"] == "nsfw"
    assert safety["score"] == 0.95
    assert safety["model"] == nsfw.MODEL_NAME
    assert "labels" not in safety
    assert "provider" not in safety


def test_detect_undetected_skips_existing_detection(in_memory_catalog, monkeypatch):
    import services.catalog.db as catalog
    from services.pipeline import nsfw

    _write_jpeg(in_memory_catalog / "media" / "foo.jpg")
    _seed()
    catalog.update_metadata(TEST_UUID, {
        "safety": {"state": "safe", "score": 0.05, "model": nsfw.MODEL_NAME, "checked_at": "2026-01-01T00:00:00Z"},
    })

    def fail_if_called(path):
        pytest.fail(f"detect_image should not be called for {path}")

    monkeypatch.setattr(nsfw, "detect_image", fail_if_called)

    nsfw.detect_undetected()


def test_video_detection_uses_thumbnail(in_memory_catalog, monkeypatch):
    import services.catalog.db as catalog
    from services.pipeline import nsfw

    thumb_path = in_memory_catalog / "thumbnails" / "foo.webp"
    _write_jpeg(thumb_path)
    _seed(extra={"thumbnail_path": "thumbnails/foo.webp"}, media_type="video")
    seen_paths = []

    def fake_detect(path):
        seen_paths.append(path)
        return {"model": nsfw.MODEL_NAME, "nsfw_score": 0.02, "state": "safe"}

    monkeypatch.setattr(nsfw, "detect_image", fake_detect)

    nsfw.detect_undetected()

    assert seen_paths == [thumb_path]
    assert catalog.get_item(TEST_UUID)["metadata"]["safety"]["state"] == "safe"


def test_safety_from_detection_simple_schema():
    from services.catalog.schema import _safety_from_detection

    result = _safety_from_detection({"model": "my-model", "nsfw_score": 0.42, "state": "safe"})

    assert result["state"] == "safe"
    assert result["score"] == 0.42
    assert result["model"] == "my-model"
    assert "checked_at" in result
    assert "labels" not in result
    assert "provider" not in result


def test_safety_from_detection_nsfw_threshold():
    from services.catalog.schema import _safety_from_detection

    result = _safety_from_detection({"model": "m", "nsfw_score": 0.97, "state": "nsfw"})

    assert result["state"] == "nsfw"
    assert result["score"] == 0.97


def test_migrate_safety_schema(in_memory_catalog, monkeypatch):
    import services.catalog.db as catalog
    from services.pipeline import nsfw

    _write_jpeg(in_memory_catalog / "media" / "foo.jpg")
    _seed()
    # Inject old-format safety directly
    catalog.update_metadata(TEST_UUID, {
        "safety": {
            "state": "safe",
            "score": 0.62,  # old: SFW score, not NSFW
            "labels": {"NSFW": 0.38, "SFW": 0.62},
            "provider": "local",
            "model": nsfw.MODEL_NAME,
            "checked_at": "2026-01-01T00:00:00Z",
        },
    })

    nsfw.migrate_safety_schema()

    safety = catalog.get_item(TEST_UUID)["metadata"]["safety"]
    assert safety["state"] == "safe"
    assert abs(safety["score"] - 0.38) < 1e-9  # now NSFW score, not SFW
    assert safety["model"] == nsfw.MODEL_NAME
    assert "labels" not in safety
    assert "provider" not in safety


def test_migrate_safety_schema_skips_already_migrated(in_memory_catalog, monkeypatch, caplog):
    import services.catalog.db as catalog
    from services.pipeline import nsfw

    _write_jpeg(in_memory_catalog / "media" / "foo.jpg")
    _seed()
    # Already in new format — no labels key
    catalog.update_metadata(TEST_UUID, {
        "safety": {"state": "safe", "score": 0.05, "model": nsfw.MODEL_NAME, "checked_at": "2026-01-01T00:00:00Z"},
    })

    with caplog.at_level("INFO"):
        nsfw.migrate_safety_schema()

    assert "nothing to migrate" in caplog.text
