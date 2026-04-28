import json
from unittest.mock import MagicMock

import chromadb
import pytest

TEST_UUID = "aaaaaaaa-0000-0000-0000-000000000002"


@pytest.fixture(autouse=True)
def in_memory_chroma(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)


def _seed(extra=None):
    import services.chroma as chroma
    chroma.upsert_content(
        file_id=TEST_UUID,
        embedding=[0.1] * 3072,
        path="data/media/foo.jpg",
        filename="foo.jpg",
        mime_type="image/jpeg",
        media_type="image",
        extra_metadata=extra or {},
    )


# --- chroma helpers ---

def test_get_all_items_with_metadata_returns_seeded_item():
    _seed()
    import services.chroma as chroma
    items = chroma.get_all_items_with_metadata()
    assert len(items) == 1
    assert items[0]["id"] == TEST_UUID
    assert items[0]["metadata"]["filename"] == "foo.jpg"



def test_update_metadata_merges_patch():
    _seed()
    import services.chroma as chroma
    chroma.update_metadata(TEST_UUID, {"description": "a photo", "search_terms": '["cat"]'})
    item = chroma.get_item(TEST_UUID)
    assert item["metadata"]["description"] == "a photo"
    assert item["metadata"]["filename"] == "foo.jpg"  # original key preserved


def test_update_metadata_raises_for_missing_id():
    import services.chroma as chroma
    with pytest.raises(ValueError, match="not found"):
        chroma.update_metadata("nonexistent-id", {"description": "x"})


# --- annotator helpers ---

def test_inline_schema_removes_defs():
    from services.annotator import _inline_schema, PackedAnnotationResponse
    schema = _inline_schema(PackedAnnotationResponse.model_json_schema())
    assert "$defs" not in schema
    assert "$ref" not in json.dumps(schema)


def test_write_annotations_stores_description_and_terms():
    _seed()
    from services.annotator import SingleImageAnnotation, _write_annotations
    ann = SingleImageAnnotation(
        file_id=TEST_UUID,
        description="a red square",
        search_terms=["red", "square"],
    )
    _write_annotations({TEST_UUID: ann}, {TEST_UUID})
    import services.chroma as chroma
    item = chroma.get_item(TEST_UUID)
    assert item["metadata"]["description"] == "a red square"
    assert json.loads(item["metadata"]["search_terms"]) == ["red", "square"]


def test_write_annotations_skips_unexpected_ids(caplog):
    _seed()
    from services.annotator import SingleImageAnnotation, _write_annotations
    ann = SingleImageAnnotation(file_id="ghost-id", description="x", search_terms=[])
    with caplog.at_level("WARNING"):
        _write_annotations({"ghost-id": ann}, {TEST_UUID})
    assert "unexpected file_id" in caplog.text
