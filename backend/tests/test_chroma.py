import chromadb
import pytest

TEST_UUID = "aaaaaaaa-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def in_memory_chroma(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)


def test_upsert_content_stores_embedding_and_metadata():
    import services.chroma as chroma
    chroma.upsert_content(
        file_id=TEST_UUID,
        embedding=[0.1] * 3072,
        path="backend/data/media/foo.jpg",
        filename="foo.jpg",
        mime_type="image/jpeg",
        media_type="image",
    )
    result = chroma.content_collection.get(ids=[TEST_UUID])
    assert result["ids"] == [TEST_UUID]
    assert result["metadatas"][0]["filename"] == "foo.jpg"
    assert result["metadatas"][0]["media_type"] == "image"


def test_upsert_content_merges_extra_metadata():
    import services.chroma as chroma
    chroma.upsert_content(
        file_id=TEST_UUID,
        embedding=[0.1] * 3072,
        path="backend/data/media/geo.jpg",
        filename="geo.jpg",
        mime_type="image/jpeg",
        media_type="image",
        extra_metadata={"EXIF_Make": "Sony", "geo_city": "Tokyo", "geo_country": "Japan"},
    )
    result = chroma.content_collection.get(ids=[TEST_UUID], include=["metadatas"])
    meta = result["metadatas"][0]
    assert meta["EXIF_Make"] == "Sony"
    assert meta["geo_city"] == "Tokyo"
    assert meta["geo_country"] == "Japan"
    assert meta["filename"] == "geo.jpg"


def test_get_embedding_returns_stored_vector():
    import services.chroma as chroma
    embedding = [0.1] * 3072
    chroma.upsert_content(
        TEST_UUID, embedding, "foo.jpg", "foo.jpg", "image/jpeg", "image",
    )
    result = chroma.get_embedding(TEST_UUID)
    assert len(result) == 3072
    assert abs(result[0] - 0.1) < 1e-6


def test_get_embedding_returns_none_for_missing():
    from services.chroma import get_embedding
    assert get_embedding("nonexistent-id") is None
