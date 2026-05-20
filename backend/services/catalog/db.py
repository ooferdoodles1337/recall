import json
import mimetypes
import random
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import config
from services.catalog import schema as metadata_schema

_db_path: Path | None = None

_PROMOTED_COLUMN_DEFS: dict[str, str] = {
    "asset_path": "TEXT",
    "thumbnail_path": "TEXT",
    "filename": "TEXT",
    "mime_type": "TEXT",
    "width": "INTEGER",
    "height": "INTEGER",
    "duration_seconds": "REAL",
    "taken_at": "TEXT",
    "taken_date": "TEXT",
    "taken_source": "TEXT",
    "geo_city": "TEXT",
    "geo_state": "TEXT",
    "geo_country": "TEXT",
    "geo_country_code": "TEXT",
    "geo_latitude": "REAL",
    "geo_longitude": "REAL",
    "search_description": "TEXT",
    "search_phrases_json": "TEXT",
    "annotation_provider": "TEXT",
    "annotation_model": "TEXT",
    "annotation_updated_at": "TEXT",
    "favorite": "INTEGER NOT NULL DEFAULT 0",
    "folders_json": "TEXT",
    "has_annotation": "INTEGER NOT NULL DEFAULT 0",
    "safety_state": "TEXT",
    "safety_score": "REAL",
}
_PROMOTED_COLUMNS = tuple(_PROMOTED_COLUMN_DEFS)
_SUMMARY_COLUMNS = (
    "id",
    "media_type",
    "taken_sort",
    "taken_year_month",
    *_PROMOTED_COLUMNS,
)


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
    added_promoted_columns = _ensure_promoted_columns(conn)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_taken_sort ON media_items(taken_sort)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_media_type ON media_items(media_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_content_hash ON media_items(content_hash)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_asset_path ON media_items(asset_path)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_mime_type ON media_items(mime_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_has_annotation ON media_items(has_annotation)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_media_items_safety_state ON media_items(safety_state)")
    _migrate_embedding_mime_types(conn)
    if added_promoted_columns or _needs_promoted_backfill(conn) or _needs_safety_score_backfill(conn):
        _backfill_promoted_columns(conn)


def _ensure_promoted_columns(conn: sqlite3.Connection) -> bool:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(media_items)").fetchall()}
    added = False
    for name, definition in _PROMOTED_COLUMN_DEFS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE media_items ADD COLUMN {name} {definition}")
            added = True
    return added


def _needs_promoted_backfill(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM media_items
        WHERE asset_path IS NULL
           OR filename IS NULL
           OR mime_type IS NULL
           OR search_phrases_json IS NULL
           OR folders_json IS NULL
        LIMIT 1
        """
    ).fetchone()
    return row is not None


def _needs_safety_score_backfill(conn: sqlite3.Connection) -> bool:
    rows = conn.execute(
        """
        SELECT metadata_json, safety_score
        FROM media_items
        WHERE metadata_json LIKE '%"labels"%'
        """
    ).fetchall()
    for row in rows:
        metadata = json.loads(row["metadata_json"])
        expected = _safety_score(_safety_metadata(metadata))
        if expected is not None and row["safety_score"] != expected:
            return True
    return False


def _metadata_json(metadata: dict) -> str:
    return json.dumps(metadata, sort_keys=True)


def _disk_mime(path: str) -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def _mime_to_media_type(mime: str) -> str:
    return "video" if mime.startswith("video/") else "image"


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _asset_number(metadata: dict, key: str, *, integer: bool) -> int | float | None:
    asset = metadata.get("asset")
    if not isinstance(asset, dict):
        return None
    return _as_int(asset.get(key)) if integer else _as_float(asset.get(key))


def _annotation_metadata(metadata: dict) -> dict:
    search = metadata.get("search")
    annotation = search.get("annotation") if isinstance(search, dict) else None
    return annotation if isinstance(annotation, dict) else {}


def _safety_metadata(metadata: dict) -> dict:
    safety = metadata.get("safety")
    return safety if isinstance(safety, dict) else {}


def _safety_score(safety: dict) -> float | None:
    labels = safety.get("labels")
    if isinstance(labels, dict):
        nsfw_score = _as_float(labels.get("NSFW"))
        if nsfw_score is not None:
            return nsfw_score
    return _as_float(safety.get("score"))


def _location_metadata(metadata: dict) -> dict:
    capture = metadata.get("capture")
    location = capture.get("location") if isinstance(capture, dict) else None
    return location if isinstance(location, dict) else {}


def _organization_metadata(metadata: dict) -> dict:
    organization = metadata.get("organization")
    return organization if isinstance(organization, dict) else {}


def _organization_folders(organization: dict) -> list[str]:
    folders = organization.get("folders")
    if not isinstance(folders, list):
        return []
    return [folder for folder in folders if isinstance(folder, str)]


def _promoted_values(metadata: dict) -> dict[str, Any]:
    description = metadata_schema.search_description(metadata)
    annotation = _annotation_metadata(metadata)
    safety = _safety_metadata(metadata)
    location = _location_metadata(metadata)
    organization = _organization_metadata(metadata)
    phrases = metadata_schema.search_phrases(metadata)
    return {
        "asset_path": metadata_schema.asset_path(metadata),
        "thumbnail_path": metadata_schema.thumbnail_path(metadata),
        "filename": metadata_schema.filename(metadata),
        "mime_type": metadata_schema.mime_type(metadata),
        "width": _asset_number(metadata, "width", integer=True),
        "height": _asset_number(metadata, "height", integer=True),
        "duration_seconds": _asset_number(metadata, "duration_seconds", integer=False),
        "taken_at": _capture_str(metadata, "taken_at"),
        "taken_date": metadata_schema.taken_date(metadata),
        "taken_source": _capture_str(metadata, "source"),
        "geo_city": _dict_str(location, "city"),
        "geo_state": _dict_str(location, "state"),
        "geo_country": _dict_str(location, "country"),
        "geo_country_code": _dict_str(location, "country_code"),
        "geo_latitude": _as_float(location.get("latitude")),
        "geo_longitude": _as_float(location.get("longitude")),
        "search_description": description,
        "search_phrases_json": json.dumps(phrases, sort_keys=True),
        "annotation_provider": _dict_str(annotation, "provider"),
        "annotation_model": _dict_str(annotation, "model"),
        "annotation_updated_at": _dict_str(annotation, "updated_at"),
        "favorite": 1 if organization.get("favorite") is True else 0,
        "folders_json": json.dumps(_organization_folders(organization), sort_keys=True),
        "has_annotation": 1 if description else 0,
        "safety_state": _dict_str(safety, "state"),
        "safety_score": _safety_score(safety),
    }


def _capture_str(metadata: dict, key: str) -> str | None:
    capture = metadata.get("capture")
    if isinstance(capture, dict) and isinstance(capture.get(key), str):
        return capture[key]
    return None


def _dict_str(data: dict, key: str) -> str | None:
    value = data.get(key)
    return value if isinstance(value, str) else None


def _promoted_params(metadata: dict) -> tuple[Any, ...]:
    values = _promoted_values(metadata)
    return tuple(values[column] for column in _PROMOTED_COLUMNS)


def _backfill_promoted_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, metadata_json FROM media_items").fetchall()
    if not rows:
        return

    set_clause = ", ".join(f"{column} = ?" for column in _PROMOTED_COLUMNS)
    for row in rows:
        metadata = json.loads(row["metadata_json"])
        conn.execute(
            f"UPDATE media_items SET {set_clause} WHERE id = ?",
            (*_promoted_params(metadata), row["id"]),
        )


def _migrate_embedding_mime_types(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, metadata_json FROM media_items").fetchall()
    for row in rows:
        metadata = json.loads(row["metadata_json"])
        stored_mime = metadata_schema.mime_type(metadata)
        stored_path = metadata_schema.asset_path(metadata)
        if not stored_mime or not stored_path:
            continue

        disk_mime = _disk_mime(stored_path)
        if disk_mime == stored_mime or disk_mime == "application/octet-stream":
            continue
        if metadata_schema.embedding_mime_type(metadata) is not None:
            continue

        disk_media_type = _mime_to_media_type(disk_mime)
        asset = metadata.get("asset")
        if isinstance(asset, dict):
            asset["embedding_mime_type"] = stored_mime
            asset["mime_type"] = disk_mime
            asset["media_type"] = disk_media_type
        else:
            metadata["embedding_mime_type"] = stored_mime
            metadata["mime_type"] = disk_mime
            metadata["media_type"] = disk_media_type

        _update_metadata_row(conn, row["id"], metadata)


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
    embedding_mime_type: str | None = None,
) -> dict:
    return metadata_schema.build_metadata(
        path=path,
        filename=filename,
        mime_type=mime_type,
        media_type=media_type,
        embedding_mime_type=embedding_mime_type,
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


def _search_phrases_from_row(row: sqlite3.Row) -> list[str]:
    value = row["search_phrases_json"]
    if not isinstance(value, str) or not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return [item for item in parsed if isinstance(item, str)]


def _json_list_from_row(row: sqlite3.Row, column: str) -> list[str]:
    value = row[column]
    if not isinstance(value, str) or not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, str)]


def _row_to_summary_item(row: sqlite3.Row) -> dict:
    item_id = row["id"]
    asset_paths: dict[str, str] = {}
    if row["asset_path"]:
        asset_paths["original"] = row["asset_path"]
    if row["thumbnail_path"]:
        asset_paths["thumbnail"] = row["thumbnail_path"]

    asset: dict[str, Any] = {
        "filename": row["filename"],
        "mime_type": row["mime_type"],
        "media_type": row["media_type"],
        "paths": asset_paths,
    }
    for key in ("width", "height", "duration_seconds"):
        if row[key] is not None:
            asset[key] = row[key]

    capture = {
        "taken_at": row["taken_at"],
        "date": row["taken_date"],
        "year_month": row["taken_year_month"],
        "sort_key": row["taken_sort"],
        "source": row["taken_source"],
    }
    capture = {key: value for key, value in capture.items() if value is not None}
    location = {
        "city": row["geo_city"],
        "state": row["geo_state"],
        "country": row["geo_country"],
        "country_code": row["geo_country_code"],
        "latitude": row["geo_latitude"],
        "longitude": row["geo_longitude"],
    }
    location = {key: value for key, value in location.items() if value is not None}
    if location:
        capture["location"] = location

    search: dict[str, Any] = {
        "description": row["search_description"],
        "phrases": _search_phrases_from_row(row),
    }
    if row["annotation_provider"] or row["annotation_model"] or row["annotation_updated_at"]:
        search["annotation"] = {
            "provider": row["annotation_provider"],
            "model": row["annotation_model"],
            "updated_at": row["annotation_updated_at"],
        }

    safety: dict[str, Any] = {}
    if row["safety_state"]:
        safety["state"] = row["safety_state"]
    if row["safety_score"] is not None:
        safety["score"] = row["safety_score"]

    metadata = {
        "asset": asset,
        "capture": capture,
        "search": search,
        "safety": safety,
        "organization": {
            "favorite": bool(row["favorite"]),
            "folders": _json_list_from_row(row, "folders_json"),
        },
    }
    return {
        "id": item_id,
        "metadata": metadata,
        "links": metadata_schema.response_links(item_id, metadata),
    }


def upsert_item(
    file_id: str,
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    extra_metadata: dict | None = None,
    embedding_mime_type: str | None = None,
) -> None:
    metadata = _metadata_for_storage(path, filename, mime_type, media_type, extra_metadata, embedding_mime_type)
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
    return _row_to_item(row) if row else None


def get_item_summary(file_id: str) -> dict | None:
    columns = ", ".join(_SUMMARY_COLUMNS)
    with _connect() as conn:
        row = conn.execute(
            f"SELECT {columns} FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    return _row_to_summary_item(row) if row else None


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


def get_all_search_terms() -> list[tuple[str, list[str]]]:
    with _connect() as conn:
        rows = conn.execute("SELECT id, search_phrases_json FROM media_items").fetchall()
    return [(row["id"], _search_phrases_from_row(row)) for row in rows]


def list_library_items(
    media_type: str | None = None,
    order: str = "desc",
) -> list[dict]:
    columns = ", ".join(_SUMMARY_COLUMNS)
    query = f"SELECT {columns} FROM media_items"
    params: list[Any] = []
    if media_type is not None:
        query += " WHERE media_type = ?"
        params.append(media_type)
    direction = "DESC" if order == "desc" else "ASC"
    id_direction = "DESC" if order == "desc" else "ASC"
    query += f" ORDER BY taken_sort IS NULL, taken_sort {direction}, id {id_direction}"

    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()

    return [_row_to_summary_item(row) for row in rows]


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
        _update_metadata_row(conn, file_id, metadata)


def replace_metadata(file_id: str, metadata: dict) -> None:
    path = metadata_schema.asset_path(metadata)
    filename = metadata_schema.filename(metadata)
    mime_type = metadata_schema.mime_type(metadata)
    media_type = metadata_schema.media_type(metadata)
    content_hash = metadata_schema.content_hash(metadata)
    if not all(isinstance(value, str) and value for value in (path, filename, mime_type, media_type, content_hash)):
        raise ValueError(f"Item metadata is missing required asset/system fields: {file_id}")

    with _connect() as conn:
        cursor = _update_metadata_row(conn, file_id, metadata)
        if cursor.rowcount == 0:
            raise ValueError(f"Item not found: {file_id}")


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


def replace_safety(file_id: str, safety: dict) -> None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, metadata_json FROM media_items WHERE id = ?",
            (file_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"Item not found: {file_id}")

    item = _row_to_stored_item(row)
    metadata = dict(item["metadata"] or {})
    metadata["safety"] = safety
    with _connect() as conn:
        cursor = _update_metadata_row(conn, file_id, metadata)
        if cursor.rowcount == 0:
            raise ValueError(f"Item not found: {file_id}")


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
