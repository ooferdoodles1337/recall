import json

import chromadb
import pytest

TEST_UUID = "aaaaaaaa-0000-0000-0000-000000000002"


@pytest.fixture(autouse=True)
def in_memory_catalog(tmp_path, monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.search.chroma.content_collection", content_col)
    import services.catalog.db as catalog
    catalog.configure(str(tmp_path / "catalog.sqlite"))
    catalog.reset()


def _seed(extra=None):
    import services.catalog.db as catalog
    metadata = {"content_hash": "test-hash"}
    if extra:
        metadata.update(extra)
    catalog.upsert_item(
        file_id=TEST_UUID,
        path="backend/data/media/foo.jpg",
        filename="foo.jpg",
        mime_type="image/jpeg",
        media_type="image",
        extra_metadata=metadata,
    )


# --- catalog helpers ---

def test_get_all_items_with_metadata_returns_seeded_item():
    _seed()
    import services.catalog.db as catalog
    items = catalog.get_all_items_with_metadata()
    assert len(items) == 1
    assert items[0]["id"] == TEST_UUID
    assert items[0]["metadata"]["asset"]["filename"] == "foo.jpg"



def test_update_metadata_merges_patch():
    _seed()
    import services.catalog.db as catalog
    catalog.update_metadata(TEST_UUID, {"search": {"description": "a photo", "phrases": ["cat"]}})
    item = catalog.get_item(TEST_UUID)
    assert item["metadata"]["search"]["description"] == "a photo"
    assert item["metadata"]["asset"]["filename"] == "foo.jpg"  # original key preserved


def test_update_metadata_raises_for_missing_id():
    import services.catalog.db as catalog
    with pytest.raises(ValueError, match="not found"):
        catalog.update_metadata("nonexistent-id", {"description": "x"})


# --- annotator helpers ---

def test_inline_schema_removes_defs():
    from services.pipeline.annotator import PackedAnnotationResponse
    from services.utils import inline_schema
    schema = inline_schema(PackedAnnotationResponse.model_json_schema())
    assert "$defs" not in schema
    assert "$ref" not in json.dumps(schema)


def test_write_annotations_stores_description_and_terms():
    _seed()
    from services.pipeline.annotator import SingleImageAnnotation, _write_annotations
    ann = SingleImageAnnotation(
        file_id=TEST_UUID,
        description="a red square",
        search_terms=["red", "square"],
    )
    _write_annotations({TEST_UUID: ann}, {TEST_UUID})
    import services.catalog.db as catalog
    item = catalog.get_item(TEST_UUID)
    assert item["metadata"]["search"]["description"] == "a red square"
    assert item["metadata"]["search"]["phrases"] == ["red", "square"]
    assert item["metadata"]["search"]["annotation"]["provider"] == "gemini"


def test_write_annotations_skips_unexpected_ids(caplog):
    _seed()
    from services.pipeline.annotator import SingleImageAnnotation, _write_annotations
    ann = SingleImageAnnotation(file_id="ghost-id", description="x", search_terms=[])
    with caplog.at_level("WARNING"):
        _write_annotations({"ghost-id": ann}, {TEST_UUID})
    assert "unexpected file_id" in caplog.text


def test_make_gemini_packs_uses_prompt_limits():
    from services.pipeline import annotator

    images = [
        {"id": f"image-{i}", "metadata": {"asset": {"mime_type": "image/jpeg"}}}
        for i in range(annotator.IMAGE_PACK_SIZE + 1)
    ]
    videos = [
        {"id": f"video-{i}", "metadata": {"asset": {"mime_type": "video/mp4"}}}
        for i in range(annotator.VIDEO_PACK_SIZE + 1)
    ]

    packs = annotator._make_gemini_packs(images + videos)

    assert [len(pack) for pack in packs] == [annotator.IMAGE_PACK_SIZE, 1, annotator.VIDEO_PACK_SIZE, 1]
    assert packs[0][0]["id"] == "image-0"
    assert packs[2][0]["id"] == "video-0"


def test_make_gemini_packs_routes_gifs_with_video_limit():
    from services.pipeline import annotator

    images = [
        {"id": f"image-{i}", "metadata": {"asset": {"paths": {"original": f"image-{i}.jpg"}, "mime_type": "image/jpeg"}}}
        for i in range(2)
    ]
    gifs = [
        {"id": f"gif-{i}", "metadata": {"asset": {"paths": {"original": f"gif-{i}.gif"}, "mime_type": "image/gif"}}}
        for i in range(6)
    ]

    packs = annotator._make_gemini_packs(images + gifs)

    assert [len(pack) for pack in packs] == [2, 5, 1]
    assert [item["id"] for item in packs[1]] == [f"gif-{i}" for i in range(5)]


def test_load_item_file_converts_unsupported_gif_to_temp_media(tmp_path, monkeypatch):
    import config
    from services.pipeline import annotator
    from services.pipeline.media import ProcessedFile

    data_dir = tmp_path / "data"
    media_dir = data_dir / "media"
    media_dir.mkdir(parents=True)
    gif_path = media_dir / "clip.gif"
    gif_path.write_bytes(b"gif-bytes")
    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    monkeypatch.setattr(
        annotator,
        "process_image",
        lambda path: ProcessedFile(data=b"mp4-bytes", mime_type="video/mp4", media_type="video"),
    )

    loaded = annotator._load_item_file({
        "id": "item-1",
        "metadata": {"asset": {"paths": {"original": "media/clip.gif"}, "mime_type": "image/gif"}},
    })

    assert loaded is not None
    assert loaded.mime_type == "video/mp4"
    assert loaded.temporary is True
    assert loaded.path.read_bytes() == b"mp4-bytes"

    temp_path = loaded.path
    annotator._cleanup_loaded_media([loaded])
    assert not temp_path.exists()


def test_annotate_unannotated_writes_each_pack_before_next(tmp_path, monkeypatch):
    import config
    import services.catalog.db as catalog
    from services.pipeline import annotator

    data_dir = tmp_path / "data"
    media_dir = data_dir / "media"
    media_dir.mkdir(parents=True)
    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    ids = ["item-1", "item-2"]
    for i, item_id in enumerate(ids):
        path = media_dir / f"{item_id}.jpg"
        path.write_bytes(b"jpeg-bytes")
        catalog.upsert_item(
            file_id=item_id,
            path=f"media/{item_id}.jpg",
            filename=f"{item_id}.jpg",
            mime_type="image/jpeg",
            media_type="image",
            extra_metadata={"content_hash": f"hash-{i}"},
        )

    calls = []
    descriptions_seen_at_call = []

    def description(item_id):
        item = catalog.get_item(item_id)
        return ((item["metadata"].get("search") or {}).get("description"))

    def fake_annotate_pack(pack, model, prompt, schema):
        calls.append(pack)
        descriptions_seen_at_call.append([description(item_id) for item_id in ids])
        return json.dumps({
            "annotations": [
                {
                    "file_id": file_id,
                    "description": f"description {file_id}",
                    "search_terms": [file_id],
                }
                for file_id, _, _ in pack
            ]
        })

    monkeypatch.setattr(annotator, "IMAGE_PACK_SIZE", 1)
    monkeypatch.setattr("services.pipeline.annotator.gemini_annotation.annotate_pack", fake_annotate_pack)

    annotator.annotate_unannotated()

    assert len(calls) == 2
    assert all(len(pack) == 1 for pack in calls)
    assert descriptions_seen_at_call[0] == [None, None]
    assert descriptions_seen_at_call[1][0] == "description item-1"
    for item_id in ids:
        item = catalog.get_item(item_id)
        assert item["metadata"]["search"]["description"] == f"description {item_id}"
