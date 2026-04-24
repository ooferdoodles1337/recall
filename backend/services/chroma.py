import chromadb

DEFAULT_DB_PATH = "data/databases"

_client = chromadb.PersistentClient(path=DEFAULT_DB_PATH)
content_collection = _client.get_or_create_collection("media_content")


def configure(path: str) -> None:
    """Switch to a different persistent ChromaDB directory (creates it if missing)."""
    global _client, content_collection
    _client = chromadb.PersistentClient(path=path)
    content_collection = _client.get_or_create_collection("media_content")


def upsert_content(
    file_id: str,
    embedding: list[float],
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    extra_metadata: dict | None = None,
) -> None:
    metadata: dict = {"path": path, "filename": filename, "mime_type": mime_type, "media_type": media_type}
    if extra_metadata:
        metadata.update(extra_metadata)
    content_collection.upsert(
        ids=[file_id],
        embeddings=[embedding],
        metadatas=[metadata],
    )


def is_indexed(file_id: str) -> bool:
    return len(content_collection.get(ids=[file_id])["ids"]) > 0
