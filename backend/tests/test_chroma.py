import chromadb
import pytest

TEST_UUID = "aaaaaaaa-0000-0000-0000-000000000001"
TEST_HASH = "abc123deadbeef"


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


def test_get_id_by_hash_returns_id_when_indexed():
    from services.chroma import upsert_content, get_id_by_hash
    upsert_content(
        TEST_UUID, [0.1] * 3072, "backend/data/media/foo.jpg", "foo.jpg", "image/jpeg", "image",
        extra_metadata={"content_hash": TEST_HASH},
    )
    assert get_id_by_hash(TEST_HASH) == TEST_UUID


def test_get_id_by_hash_returns_none_when_missing():
    from services.chroma import get_id_by_hash
    assert get_id_by_hash("nonexistent-hash") is None


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


def test_list_library_items_sorts_by_taken_date_and_filters_media_type():
    import services.chroma as chroma
    chroma.upsert_content(
        "old-id", [0.1] * 3072, "old.jpg", "old.jpg", "image/jpeg", "image",
        extra_metadata={"taken_sort": "2024-03-17T10:00:00", "taken_date": "2024-03-17"},
    )
    chroma.upsert_content(
        "new-id", [0.1] * 3072, "new.jpg", "new.jpg", "image/jpeg", "image",
        extra_metadata={"taken_sort": "2024-03-18T10:00:00", "taken_date": "2024-03-18"},
    )
    chroma.upsert_content(
        "video-id", [0.1] * 3072, "video.mp4", "video.mp4", "video/mp4", "video",
        extra_metadata={"taken_sort": "2024-03-19T10:00:00", "taken_date": "2024-03-19"},
    )

    items = chroma.list_library_items(media_type="image", order="desc")

    item_ids = [item["id"] for item in items]
    assert item_ids[:2] == ["new-id", "old-id"]
    assert "video-id" not in item_ids
