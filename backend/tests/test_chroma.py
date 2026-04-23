import chromadb
import pytest


@pytest.fixture(autouse=True)
def in_memory_chroma(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    metadata_col = ephemeral.get_or_create_collection("media_metadata")
    monkeypatch.setattr("services.chroma.content_collection", content_col)
    monkeypatch.setattr("services.chroma.metadata_collection", metadata_col)


def test_upsert_content_stores_embedding_and_metadata():
    import services.chroma as chroma
    chroma.upsert_content(
        file_id="data/media/foo.jpg",
        embedding=[0.1] * 3072,
        path="data/media/foo.jpg",
        filename="foo.jpg",
        mime_type="image/jpeg",
        media_type="image",
    )
    result = chroma.content_collection.get(ids=["data/media/foo.jpg"])
    assert result["ids"] == ["data/media/foo.jpg"]
    assert result["metadatas"][0]["filename"] == "foo.jpg"
    assert result["metadatas"][0]["media_type"] == "image"


def test_upsert_metadata_stores_document():
    import services.chroma as chroma
    chroma.upsert_metadata(
        file_id="data/media/foo.jpg",
        embedding=[0.2] * 3072,
        document="filename: foo.jpg | size: 1.00MB",
        path="data/media/foo.jpg",
        filename="foo.jpg",
        mime_type="image/jpeg",
        media_type="image",
    )
    result = chroma.metadata_collection.get(ids=["data/media/foo.jpg"], include=["documents"])
    assert result["ids"] == ["data/media/foo.jpg"]
    assert result["documents"][0] == "filename: foo.jpg | size: 1.00MB"


def test_is_indexed_true_when_in_both_collections():
    from services.chroma import upsert_content, upsert_metadata, is_indexed
    file_id = "data/media/foo.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "foo.jpg", "image/jpeg", "image")
    upsert_metadata(file_id, [0.2] * 3072, "text", file_id, "foo.jpg", "image/jpeg", "image")
    assert is_indexed(file_id) is True


def test_is_indexed_false_when_missing():
    from services.chroma import is_indexed
    assert is_indexed("data/media/missing.jpg") is False


def test_is_indexed_false_when_only_in_content():
    from services.chroma import upsert_content, is_indexed
    file_id = "data/media/partial.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "partial.jpg", "image/jpeg", "image")
    assert is_indexed(file_id) is False


def test_is_indexed_false_when_only_in_metadata():
    from services.chroma import upsert_metadata, is_indexed
    file_id = "data/media/meta-only.jpg"
    upsert_metadata(file_id, [0.2] * 3072, "text", file_id, "meta-only.jpg", "image/jpeg", "image")
    assert is_indexed(file_id) is False
