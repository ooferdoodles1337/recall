import chromadb

from config import DB_PATH

DEFAULT_DB_PATH = str(DB_PATH)

_client: chromadb.ClientAPI | None = None
content_collection: chromadb.Collection | None = None


def configure(path: str | None = None) -> None:
    """Switch to a different persistent ChromaDB directory (creates it if missing)."""
    global _client, content_collection
    _client = chromadb.PersistentClient(path=path or DEFAULT_DB_PATH)
    content_collection = _client.get_or_create_collection("media_content")


def reset_collection() -> None:
    """Delete and recreate the media_content collection, removing all indexed data."""
    global content_collection
    client = _client
    if client is None:
        configure()
        client = _client
    client.delete_collection("media_content")
    content_collection = client.get_or_create_collection("media_content")


def _collection() -> chromadb.Collection:
    if content_collection is None:
        configure()
    return content_collection


def upsert_content(
    file_id: str,
    embedding: list[float],
) -> None:
    _collection().upsert(
        ids=[file_id],
        embeddings=[embedding],
    )


def get_embedding(file_id: str) -> list[float] | None:
    result = _collection().get(ids=[file_id], include=["embeddings"])
    if not result["ids"]:
        return None
    return list(result["embeddings"][0])


def search(
    embedding: list[float],
    n_results: int = 5,
) -> dict:
    """Query the media collection and return the top-k matches."""
    return _collection().query(
        query_embeddings=[embedding],
        n_results=n_results,
    )
