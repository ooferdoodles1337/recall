import json
import random
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import config
from services.catalog import schema as metadata_schema
from services.catalog._db_migrations import (
    _DB_SCHEMA_VERSION,
    backfill_promoted_columns,
    ensure_promoted_columns,
    get_schema_version,
    needs_promoted_backfill,
    needs_safety_score_backfill,
    run_migrations,
    set_schema_version,
)
from services.catalog._db_serialization import (
    _PROMOTED_COLUMNS,
    _SUMMARY_COLUMNS,
    _metadata_json,
    _promoted_params,
    _search_phrases_from_row,
    metadata_for_storage,
    row_to_item,
    row_to_stored_item,
    row_to_summary_item,
)

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


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    if _db_path is None:
        configure()
    assert _db_path is not None
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS media_items (
            id TEXT PRIMARY KEY,
            media_type TEXT NOT NULL,
            content_hash TEXT NOT NULL UNIQUE,
            taken_sort TEXT,
            taken_year_month TEXT,
            asset_path TEXT,
            thumbnail_path TEXT,
            filename TEXT,
            mime_type TEXT,
            embedding_mime_type TEXT,
            file_size INTEGER,
            file_mtime_ns INTEGER,
            width INTEGER,
            height INTEGER,
            duration_seconds REAL,
            taken_at TEXT,
            taken_date TEXT,
            taken_source TEXT,
            geo_city TEXT,
            geo_state TEXT,
            geo_country TEXT,
            geo_country_code TEXT,
            geo_latitude REAL,
            geo_longitude REAL,
            search_description TEXT,
            search_phrases_json TEXT,
            annotation_provider TEXT,
            annotation_model TEXT,
            annotation_updated_at TEXT,
            favorite INTEGER NOT NULL DEFAULT 0,
            folders_json TEXT,
            has_annotation INTEGER NOT NULL DEFAULT 0,
            safety_state TEXT,
            safety_score REAL,
            metadata_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    added_promoted_columns = ensure_promoted_columns(conn)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_taken_sort ON media_items(taken_sort)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_media_type ON media_items(media_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_content_hash ON media_items(content_hash)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_asset_path ON media_items(asset_path)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_mime_type ON media_items(mime_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_has_annotation ON media_items(has_annotation)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_safety_state ON media_items(safety_state)")

    current_version = get_schema_version(conn)
    if current_version < _DB_SCHEMA_VERSION:
        run_migrations(conn, from_version=current_version)
        set_schema_version(conn, _DB_SCHEMA_VERSION)

    if added_promoted_columns or needs_promoted_backfill(conn) or needs_safety_score_backfill(conn):
        backfill_promoted_columns(conn)


def reset() -> None:
    with _connect() as conn:
        conn.execute("DROP TABLE IF EXISTS media_items")
        conn.execute("DROP TABLE IF EXISTS schema_version")
        _init_schema(conn)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def upsert_item(
    file_id: str,
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    extra_metadata: dict | None = None,
    embedding_mime_type: str | None = None,
) -> None:
    metadata = metadata_for_storage(path, filename, mime_type, media_type, extra_metadata, embedding_mime_type)
    content_hash = metadata_schema.content_hash(metadata)
    if not isinstance(content_hash, str) or not content_hash:
        raise ValueError("content_hash is required for catalog items")

    promoted = _promoted_params(metadata)
    promoted_column_sql = ", ".join(_PROMOTED_COLUMNS)
    promoted_placeholder_sql = ", ".join("?" for _ in _PROMOTED_COLUMNS)
    promoted_update_sql = ",\n                ".join(f"{column} = excluded.{column}" for column in _PROMOTED_COLUMNS)
    with _connect() as conn:
        conn.execute(
            f"""
            INSERT INTO media_items (
                id, media_type, content_hash, taken_sort, taken_year_month, metadata_json,
                {promoted_column_sql}
            )
            VALUES (?, ?, ?, ?, ?, ?, {promoted_placeholder_sql})
            ON CONFLICT(id) DO UPDATE SET
                media_type = excluded.media_type,
                content_hash = excluded.content_hash,
                taken_sort = excluded.taken_sort,
                taken_year_month = excluded.taken_year_month,
                metadata_json = excluded.metadata_json,
                {promoted_update_sql},
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                file_id,
                media_type,
                content_hash,
                metadata_schema.taken_sort(metadata),
                metadata_schema.taken_year_month(metadata),
                _metadata_json(metadata),
                *promoted,
            ),
        )


def get_item(file_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, metadata_json FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    return row_to_item(row) if row else None


def get_item_summary(file_id: str) -> dict | None:
    columns = ", ".join(_SUMMARY_COLUMNS)
    with _connect() as conn:
        row = conn.execute(
            f"SELECT {columns} FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    return row_to_summary_item(row) if row else None


# SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999 on older builds; stay well under it.
_MAX_SQL_VARIABLES = 900


def get_item_summaries(file_ids: list[str]) -> dict[str, dict]:
    """Fetch summaries for many ids in a single connection (chunked IN queries).

    Returns a dict keyed by id; missing ids are simply absent. Callers preserve
    their own ordering, so this never imposes a result order.
    """
    if not file_ids:
        return {}
    columns = ", ".join(_SUMMARY_COLUMNS)
    summaries: dict[str, dict] = {}
    with _connect() as conn:
        for start in range(0, len(file_ids), _MAX_SQL_VARIABLES):
            chunk = file_ids[start:start + _MAX_SQL_VARIABLES]
            placeholders = ", ".join("?" for _ in chunk)
            rows = conn.execute(
                f"SELECT {columns} FROM media_items WHERE id IN ({placeholders})",
                chunk,
            ).fetchall()
            for row in rows:
                summaries[row["id"]] = row_to_summary_item(row)
    return summaries


def get_id_by_hash(content_hash: str) -> str | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id FROM media_items WHERE content_hash = ?",
            (content_hash,),
        ).fetchone()
    return row["id"] if row else None


def get_index_records() -> list[dict]:
    """Return lightweight file-state records used by incremental indexing."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, asset_path, content_hash, file_size, file_mtime_ns
            FROM media_items
            """
        ).fetchall()
    return [
        {
            "id": row["id"],
            "asset_path": row["asset_path"],
            "content_hash": row["content_hash"],
            "file_size": row["file_size"],
            "file_mtime_ns": row["file_mtime_ns"],
        }
        for row in rows
    ]


def get_all_items_with_metadata() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT id, metadata_json FROM media_items").fetchall()
    return [row_to_item(row) for row in rows]


def get_all_search_terms() -> list[tuple[str, list[str]]]:
    with _connect() as conn:
        rows = conn.execute("SELECT id, search_phrases_json FROM media_items").fetchall()
    return [(row["id"], _search_phrases_from_row(row)) for row in rows]


def list_library_items(
    media_type: str | None = None,
    favorite: bool | None = None,
    date_prefix: str | None = None,
    order: str = "desc",
    limit: int | None = None,
) -> list[dict]:
    columns = ", ".join(_SUMMARY_COLUMNS)
    query = f"SELECT {columns} FROM media_items"
    params: list[Any] = []
    filters: list[str] = []
    if media_type is not None:
        filters.append("media_type = ?")
        params.append(media_type)
    if favorite is not None:
        filters.append("favorite = ?")
        params.append(1 if favorite else 0)
    if date_prefix is not None:
        filters.append("taken_sort LIKE ?")
        params.append(f"{date_prefix}%")
    if filters:
        query += " WHERE " + " AND ".join(filters)
    direction = "DESC" if order == "desc" else "ASC"
    id_direction = "DESC" if order == "desc" else "ASC"
    query += f" ORDER BY taken_sort IS NULL, taken_sort {direction}, id {id_direction}"
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)

    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()

    return [row_to_summary_item(row) for row in rows]


def delete_item(file_id: str) -> None:
    """Remove a single item from the catalog by ID."""
    with _connect() as conn:
        conn.execute("DELETE FROM media_items WHERE id = ?", (file_id,))


def get_all_asset_records() -> list[tuple[str, str, str | None, str | None]]:
    """Return (id, media_type, asset_path, thumbnail_path) for every item."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, media_type, asset_path, thumbnail_path FROM media_items"
        ).fetchall()
    return [
        (row["id"], row["media_type"] or "image", row["asset_path"], row["thumbnail_path"])
        for row in rows
    ]


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

    item = row_to_stored_item(row)
    metadata = metadata_schema.merge_metadata(item["metadata"] or {}, patch)
    _validate_required_fields(file_id, metadata)

    with _connect() as conn:
        _update_metadata_row(conn, file_id, metadata)


def replace_metadata(file_id: str, metadata: dict) -> None:
    _validate_required_fields(file_id, metadata)
    with _connect() as conn:
        cursor = _update_metadata_row(conn, file_id, metadata)
        if cursor.rowcount == 0:
            raise ValueError(f"Item not found: {file_id}")


def _validate_required_fields(file_id: str, metadata: dict) -> None:
    path = metadata_schema.asset_path(metadata)
    filename = metadata_schema.filename(metadata)
    mime_type = metadata_schema.mime_type(metadata)
    media_type = metadata_schema.media_type(metadata)
    content_hash = metadata_schema.content_hash(metadata)
    if not all(isinstance(value, str) and value for value in (path, filename, mime_type, media_type, content_hash)):
        raise ValueError(f"Item metadata is missing required asset/system fields: {file_id}")


def patch_item(file_id: str, patch: dict) -> dict:
    """Deep-merge a partial metadata patch into an existing item's metadata_json.
    Promotes changed fields to SQLite columns. Returns the updated item."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, metadata_json FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"Item not found: {file_id}")

    existing_metadata = json.loads(row["metadata_json"])
    merged = metadata_schema.merge_metadata(existing_metadata, patch)
    _validate_required_fields(file_id, merged)

    with _connect() as conn:
        _update_metadata_row(conn, file_id, merged)

    return get_item(file_id) or {"id": file_id, "metadata": merged}


def replace_safety(file_id: str, safety: dict) -> None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, metadata_json FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"Item not found: {file_id}")

    item = row_to_stored_item(row)
    metadata = dict(item["metadata"] or {})
    metadata["safety"] = safety
    with _connect() as conn:
        cursor = _update_metadata_row(conn, file_id, metadata)
        if cursor.rowcount == 0:
            raise ValueError(f"Item not found: {file_id}")


def get_records_for_animated_regen() -> list[tuple[str, str | None, str | None]]:
    """Return (id, asset_path, animated_thumbnail_path) for all GIF items."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, asset_path, animated_thumbnail_path FROM media_items WHERE mime_type = 'image/gif'"
        ).fetchall()
    return [(row["id"], row["asset_path"], row["animated_thumbnail_path"]) for row in rows]


def update_animated_thumbnail_path(file_id: str, animated_thumbnail_path: str | None) -> None:
    """Set or clear the animated_thumbnail_path for a single item."""
    with _connect() as conn:
        row = conn.execute("SELECT metadata_json FROM media_items WHERE id = ?", (file_id,)).fetchone()
        if row is None:
            return
        metadata = json.loads(row["metadata_json"])
        asset = metadata.get("asset")
        if isinstance(asset, dict):
            paths = asset.setdefault("paths", {})
            if animated_thumbnail_path:
                paths["animated_thumbnail"] = animated_thumbnail_path
            else:
                paths.pop("animated_thumbnail", None)
        conn.execute(
            "UPDATE media_items SET animated_thumbnail_path = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (animated_thumbnail_path, _metadata_json(metadata), file_id),
        )


def update_display_path(file_id: str, display_path: str | None) -> None:
    """Set or clear the display rendition path for a single item (metadata_json only)."""
    with _connect() as conn:
        row = conn.execute("SELECT metadata_json FROM media_items WHERE id = ?", (file_id,)).fetchone()
        if row is None:
            return
        metadata = json.loads(row["metadata_json"])
        asset = metadata.get("asset")
        if isinstance(asset, dict):
            paths = asset.setdefault("paths", {})
            if display_path:
                paths["display"] = display_path
            else:
                paths.pop("display", None)
        conn.execute(
            "UPDATE media_items SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (_metadata_json(metadata), file_id),
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


# ---------------------------------------------------------------------------
# Internal write helper
# ---------------------------------------------------------------------------

def _update_metadata_row(conn: sqlite3.Connection, file_id: str, metadata: dict) -> sqlite3.Cursor:
    promoted_set_sql = ",\n                ".join(f"{column} = ?" for column in _PROMOTED_COLUMNS)
    return conn.execute(
        f"""
        UPDATE media_items
        SET
            media_type = ?,
            content_hash = ?,
            taken_sort = ?,
            taken_year_month = ?,
            metadata_json = ?,
            {promoted_set_sql},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            metadata_schema.media_type(metadata),
            metadata_schema.content_hash(metadata),
            metadata_schema.taken_sort(metadata),
            metadata_schema.taken_year_month(metadata),
            _metadata_json(metadata),
            *_promoted_params(metadata),
            file_id,
        ),
    )
