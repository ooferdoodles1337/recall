import random

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
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    extra_metadata: dict | None = None,
) -> None:
    metadata: dict = {"path": path, "filename": filename, "mime_type": mime_type, "media_type": media_type}
    if extra_metadata:
        metadata.update(extra_metadata)
    _collection().upsert(
        ids=[file_id],
        embeddings=[embedding],
        metadatas=[metadata],
    )


def get_id_by_hash(content_hash: str) -> str | None:
    result = _collection().get(where={"content_hash": content_hash}, include=[])
    if not result["ids"]:
        return None
    return result["ids"][0]


def search(
    embedding: list[float],
    n_results: int = 5,
) -> dict:
    """Query the media collection and return the top-k matches."""
    return _collection().query(
        query_embeddings=[embedding],
        n_results=n_results,
    )


def get_item(file_id: str) -> dict | None:
    result = _collection().get(ids=[file_id], include=["metadatas"])
    if not result["ids"]:
        return None
    return {"id": result["ids"][0], "metadata": result["metadatas"][0]}


def get_random_ids(n: int) -> list[str]:
    all_ids = _collection().get(include=[])["ids"]
    return random.sample(all_ids, min(n, len(all_ids)))


def get_all_items_with_metadata() -> list[dict]:
    result = _collection().get(include=["metadatas"])
    return [
        {"id": id_, "metadata": meta}
        for id_, meta in zip(result["ids"], result["metadatas"])
    ]


def list_library_items(
    media_type: str | None = None,
    order: str = "desc",
) -> list[dict]:
    items = []
    for item in get_all_items_with_metadata():
        meta = item["metadata"] or {}
        if media_type is not None and meta.get("media_type") != media_type:
            continue
        items.append({"id": item["id"], "metadata": meta})

    reverse = order == "desc"
    return sorted(
        items,
        key=lambda item: ((item["metadata"] or {}).get("taken_sort", ""), item["id"]),
        reverse=reverse,
    )


def update_metadata(file_id: str, patch: dict) -> None:
    item = get_item(file_id)
    if item is None:
        raise ValueError(f"Item not found: {file_id}")
    existing = item["metadata"] or {}
    merged = {**existing, **patch}
    _collection().update(ids=[file_id], metadatas=[merged])


def get_stats() -> dict:
    result = _collection().get(include=["metadatas"])
    total = len(result["ids"])
    type_counts: dict[str, int] = {}
    for meta in result["metadatas"]:
        mt = (meta or {}).get("media_type", "unknown")
        type_counts[mt] = type_counts.get(mt, 0) + 1
    return {"total": total, "by_media_type": type_counts}
