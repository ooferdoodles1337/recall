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


def test_annotate_unannotated_streams_gemini_submissions(tmp_path, monkeypatch):
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

    def fake_annotate_packs_batch(packs, model, prompt, schema):
        calls.append(packs)
        return [
            json.dumps({
                "annotations": [
                    {"file_id": file_id, "description": f"description {file_id}", "search_terms": [file_id]}
                    for file_id, _, _ in pack
                ]
            })
            for pack in packs
        ]

    monkeypatch.setattr(annotator, "IMAGE_PACK_SIZE", 1)
    monkeypatch.setattr(annotator, "GEMINI_SUBMISSION_MEDIA_BYTE_TARGET", 1)
    monkeypatch.setattr("services.pipeline.annotator.gemini_annotation.annotate_packs_batch", fake_annotate_packs_batch)

    annotator.annotate_unannotated()

    assert len(calls) == 2
    assert all(len(call) == 1 for call in calls)
    for item_id in ids:
        item = catalog.get_item(item_id)
        assert item["metadata"]["search"]["description"] == f"description {item_id}"
