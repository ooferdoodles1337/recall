import json
import random
import sqlite3
from pathlib import Path
from typing import Any

import config
from services import metadata_schema

_db_path: Path | None = None


def _default_db_path() -> Path:
    return config.CATALOG_DB_PATH


def configure(path: str | None = None) -> None:
    """Configure and initialize the SQLite media catalog."""
    global _db_path
    _db_path = Path(path) if path is not None else _default_db_path()
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        _init_schema(conn)


def _connect() -> sqlite3.Connection:
    if _db_path is None:
        configure()
    assert _db_path is not None
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS media_items (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            media_type TEXT NOT NULL,
            content_hash TEXT NOT NULL UNIQUE,
            taken_sort TEXT,
            taken_date TEXT,
            taken_year_month TEXT,
            metadata_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_taken_sort ON media_items(taken_sort)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_taken_date ON media_items(taken_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_media_type ON media_items(media_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_content_hash ON media_items(content_hash)")


def reset() -> None:
    with _connect() as conn:
        conn.execute("DROP TABLE IF EXISTS media_items")
        _init_schema(conn)


def _metadata_for_storage(
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    extra_metadata: dict | None,
) -> dict:
    return metadata_schema.build_metadata(
        path=path,
        filename=filename,
        mime_type=mime_type,
        media_type=media_type,
        extra_metadata=extra_metadata,
    )


def _row_to_item(row: sqlite3.Row) -> dict:
    item_id = row["id"]
    metadata = json.loads(row["metadata_json"])
    return {
        "id": item_id,
        "metadata": metadata,
        "links": metadata_schema.response_links(item_id, metadata),
    }


def _row_to_stored_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "metadata": json.loads(row["metadata_json"]),
    }


def upsert_item(
    file_id: str,
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    extra_metadata: dict | None = None,
) -> None:
    metadata = _metadata_for_storage(path, filename, mime_type, media_type, extra_metadata)
    content_hash = metadata_schema.content_hash(metadata)
    if not isinstance(content_hash, str) or not content_hash:
        raise ValueError("content_hash is required for catalog items")

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO media_items (
                id, path, filename, mime_type, media_type, content_hash,
                taken_sort, taken_date, taken_year_month, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                path = excluded.path,
                filename = excluded.filename,
                mime_type = excluded.mime_type,
                media_type = excluded.media_type,
                content_hash = excluded.content_hash,
                taken_sort = excluded.taken_sort,
                taken_date = excluded.taken_date,
                taken_year_month = excluded.taken_year_month,
                metadata_json = excluded.metadata_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                file_id,
                path,
                filename,
                mime_type,
                media_type,
                content_hash,
                metadata_schema.taken_sort(metadata),
                metadata_schema.taken_date(metadata),
                metadata_schema.taken_year_month(metadata),
                json.dumps(metadata, sort_keys=True),
            ),
        )


def get_item(file_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, metadata_json FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    return _row_to_item(row) if row else None


def get_id_by_hash(content_hash: str) -> str | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id FROM media_items WHERE content_hash = ?",
            (content_hash,),
        ).fetchone()
    return row["id"] if row else None


def get_all_items_with_metadata() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT id, metadata_json FROM media_items").fetchall()
    return [_row_to_item(row) for row in rows]


def list_library_items(
    media_type: str | None = None,
    order: str = "desc",
) -> list[dict]:
    query = "SELECT id, metadata_json FROM media_items"
    params: list[Any] = []
    if media_type is not None:
        query += " WHERE media_type = ?"
        params.append(media_type)

    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()

    items = [_row_to_item(row) for row in rows]
    reverse = order == "desc"
    return sorted(
        items,
        key=lambda item: (metadata_schema.taken_sort(item["metadata"] or {}) or "", item["id"]),
        reverse=reverse,
    )


def get_random_ids(n: int) -> list[str]:
    with _connect() as conn:
        rows = conn.execute("SELECT id FROM media_items").fetchall()
    ids = [row["id"] for row in rows]
    return random.sample(ids, min(n, len(ids)))


def update_metadata(file_id: str, patch: dict) -> None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, metadata_json FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"Item not found: {file_id}")

    item = _row_to_stored_item(row)
    metadata = metadata_schema.merge_metadata(item["metadata"] or {}, patch)
    path = metadata_schema.asset_path(metadata)
    filename = metadata_schema.filename(metadata)
    mime_type = metadata_schema.mime_type(metadata)
    media_type = metadata_schema.media_type(metadata)
    content_hash = metadata_schema.content_hash(metadata)
    if not all(isinstance(value, str) and value for value in (path, filename, mime_type, media_type, content_hash)):
        raise ValueError(f"Item metadata is missing required asset/system fields: {file_id}")

    with _connect() as conn:
        conn.execute(
            """
            UPDATE media_items
            SET
                path = ?,
                filename = ?,
                mime_type = ?,
                media_type = ?,
                content_hash = ?,
                taken_sort = ?,
                taken_date = ?,
                taken_year_month = ?,
                metadata_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                path,
                filename,
                mime_type,
                media_type,
                content_hash,
                metadata_schema.taken_sort(metadata),
                metadata_schema.taken_date(metadata),
                metadata_schema.taken_year_month(metadata),
                json.dumps(metadata, sort_keys=True),
                file_id,
            ),
        )


def get_stats() -> dict:
    with _connect() as conn:
        total = conn.execute("SELECT COUNT(*) AS total FROM media_items").fetchone()["total"]
        rows = conn.execute(
            "SELECT media_type, COUNT(*) AS count FROM media_items GROUP BY media_type"
        ).fetchall()
    return {
        "total": total,
        "by_media_type": {row["media_type"] or "unknown": row["count"] for row in rows},
    }


def get_facets() -> dict:
    with _connect() as conn:
        by_type = conn.execute(
            "SELECT media_type, COUNT(*) AS count FROM media_items GROUP BY media_type ORDER BY media_type"
        ).fetchall()
        by_month = conn.execute(
            "SELECT taken_year_month, COUNT(*) AS count FROM media_items"
            " WHERE taken_year_month IS NOT NULL"
            " GROUP BY taken_year_month ORDER BY taken_year_month"
        ).fetchall()
    return {
        "media_type": {row["media_type"] or "unknown": row["count"] for row in by_type},
        "taken_year_month": {row["taken_year_month"]: row["count"] for row in by_month},
    }
