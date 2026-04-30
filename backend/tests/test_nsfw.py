import io

import chromadb
import pytest
from PIL import Image

TEST_UUID = "aaaaaaaa-0000-0000-0000-000000000003"


@pytest.fixture(autouse=True)
def in_memory_catalog(tmp_path, monkeypatch):
    import config
    import services.catalog as catalog

    data_dir = tmp_path / "data"
    media_dir = data_dir / "media"
    thumbs_dir = data_dir / "thumbnails"
    media_dir.mkdir(parents=True)
    thumbs_dir.mkdir(parents=True)
    monkeypatch.setattr(config, "DATA_DIR", data_dir)

    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)

    catalog.configure(str(tmp_path / "catalog.sqlite"))
    catalog.reset()
    return data_dir


def _write_jpeg(path):
    image = Image.new("RGB", (10, 10), color=(255, 0, 0))
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    path.write_bytes(buf.getvalue())


def _seed(extra=None, media_type="image"):
    import services.catalog as catalog

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
    import services.catalog as catalog
    from services import nsfw

    _write_jpeg(in_memory_catalog / "media" / "foo.jpg")
    _seed()
    monkeypatch.setattr(
        nsfw,
        "detect_image",
        lambda path: {
            "model": nsfw.MODEL_NAME,
            "label": "nsfw",
            "score": 0.9,
            "probabilities": {"nsfw": 0.9, "safe": 0.1},
        },
    )

    nsfw.detect_undetected()

    detection = catalog.get_item(TEST_UUID)["metadata"]["nsfw_detection"]
    assert detection["label"] == "nsfw"
    assert detection["score"] == 0.9
    assert detection["probabilities"]["safe"] == 0.1


def test_detect_undetected_skips_existing_detection(in_memory_catalog, monkeypatch):
    from services import nsfw

    _write_jpeg(in_memory_catalog / "media" / "foo.jpg")
    _seed(extra={"nsfw_detection": {"label": "safe"}})

    def fail_if_called(path):
        pytest.fail(f"detect_image should not be called for {path}")

    monkeypatch.setattr(nsfw, "detect_image", fail_if_called)

    nsfw.detect_undetected()


def test_video_detection_uses_thumbnail(in_memory_catalog, monkeypatch):
    import services.catalog as catalog
    from services import nsfw

    thumb_path = in_memory_catalog / "thumbnails" / "foo.webp"
    _write_jpeg(thumb_path)
    _seed(extra={"thumbnail_path": "thumbnails/foo.webp"}, media_type="video")
    seen_paths = []

    def fake_detect(path):
        seen_paths.append(path)
        return {"model": nsfw.MODEL_NAME, "label": "safe", "score": 1.0, "probabilities": {"safe": 1.0}}

    monkeypatch.setattr(nsfw, "detect_image", fake_detect)

    nsfw.detect_undetected()

    assert seen_paths == [thumb_path]
    assert catalog.get_item(TEST_UUID)["metadata"]["nsfw_detection"]["label"] == "safe"
