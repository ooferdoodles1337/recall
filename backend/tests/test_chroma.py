import chromadb
import pytest

TEST_UUID = "aaaaaaaa-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def in_memory_chroma(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)


def test_upsert_content_stores_embedding_only():
    import services.chroma as chroma
    chroma.upsert_content(
        file_id=TEST_UUID,
        embedding=[0.1] * 3072,
    )
    result = chroma.content_collection.get(ids=[TEST_UUID], include=["metadatas"])
    assert result["ids"] == [TEST_UUID]
    assert result["metadatas"] == [None]


def test_upsert_content_does_not_store_metadata():
    import services.chroma as chroma
    chroma.upsert_content(
        file_id=TEST_UUID,
        embedding=[0.1] * 3072,
    )
    result = chroma.content_collection.get(ids=[TEST_UUID], include=["metadatas"])
    assert result["metadatas"] == [None]


def test_get_embedding_returns_stored_vector():
    import services.chroma as chroma
    embedding = [0.1] * 3072
    chroma.upsert_content(TEST_UUID, embedding)
    result = chroma.get_embedding(TEST_UUID)
    assert len(result) == 3072
    assert abs(result[0] - 0.1) < 1e-6


def test_get_embedding_returns_none_for_missing():
    from services.chroma import get_embedding
    assert get_embedding("nonexistent-id") is None
