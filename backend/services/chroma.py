import chromadb

_client = chromadb.PersistentClient(path="data/chroma_db")
content_collection = _client.get_or_create_collection("media_content")
metadata_collection = _client.get_or_create_collection("media_metadata")


def upsert_content(
    file_id: str,
    embedding: list[float],
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
) -> None:
    content_collection.upsert(
        ids=[file_id],
        embeddings=[embedding],
        metadatas=[{"path": path, "filename": filename, "mime_type": mime_type, "media_type": media_type}],
    )


def upsert_metadata(
    file_id: str,
    embedding: list[float],
    document: str,
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
) -> None:
    metadata_collection.upsert(
        ids=[file_id],
        embeddings=[embedding],
        documents=[document],
        metadatas=[{"path": path, "filename": filename, "mime_type": mime_type, "media_type": media_type}],
    )


def is_indexed(file_id: str) -> bool:
    in_content = len(content_collection.get(ids=[file_id])["ids"]) > 0
    in_metadata = len(metadata_collection.get(ids=[file_id])["ids"]) > 0
    return in_content and in_metadata
