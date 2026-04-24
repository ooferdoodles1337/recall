import chromadb
import pytest


@pytest.fixture(autouse=True)
def in_memory_chroma(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)


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


def test_is_indexed_true_when_in_content():
    from services.chroma import upsert_content, is_indexed
    file_id = "data/media/foo.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "foo.jpg", "image/jpeg", "image")
    assert is_indexed(file_id) is True


def test_is_indexed_false_when_missing():
    from services.chroma import is_indexed
    assert is_indexed("data/media/missing.jpg") is False


def test_upsert_content_merges_extra_metadata():
    import services.chroma as chroma
    chroma.upsert_content(
        file_id="data/media/geo.jpg",
        embedding=[0.1] * 3072,
        path="data/media/geo.jpg",
        filename="geo.jpg",
        mime_type="image/jpeg",
        media_type="image",
        extra_metadata={"EXIF_Make": "Sony", "geo_city": "Tokyo", "geo_country": "Japan"},
    )
    result = chroma.content_collection.get(
        ids=["data/media/geo.jpg"], include=["metadatas"]
    )
    meta = result["metadatas"][0]
    assert meta["EXIF_Make"] == "Sony"
    assert meta["geo_city"] == "Tokyo"
    assert meta["geo_country"] == "Japan"
    assert meta["filename"] == "geo.jpg"
