"""Schema migration logic for the catalog SQLite database.

Internal module — do not import outside of services/catalog/db.py.
"""

from __future__ import annotations

import json
import mimetypes
import sqlite3

from services.catalog import schema as metadata_schema
from services.catalog._db_serialization import (
    _metadata_json,
    _promoted_params,
    _PROMOTED_COLUMN_DEFS,
    _PROMOTED_COLUMNS,
    _safety_metadata,
    _safety_score,
)

_DB_SCHEMA_VERSION = 2


def get_schema_version(conn: sqlite3.Connection) -> int:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        )
    """)
    row = conn.execute("SELECT version FROM schema_version LIMIT 1").fetchone()
    return row["version"] if row else 0


def set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute("DELETE FROM schema_version")
    conn.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))


def run_migrations(conn: sqlite3.Connection, from_version: int) -> None:
    if from_version < 1:
        _migrate_embedding_mime_types(conn)
    if from_version < 2:
        _backfill_embedding_mime_type_in_json(conn)


def ensure_promoted_columns(conn: sqlite3.Connection) -> bool:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(media_items)").fetchall()}
    added = False
    for name, definition in _PROMOTED_COLUMN_DEFS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE media_items ADD COLUMN {name} {definition}")
            added = True
    return added


def needs_promoted_backfill(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM media_items
        WHERE asset_path IS NULL
           OR filename IS NULL
           OR mime_type IS NULL
           OR embedding_mime_type IS NULL
           OR search_phrases_json IS NULL
           OR folders_json IS NULL
        LIMIT 1
        """
    ).fetchone()
    return row is not None


def needs_safety_score_backfill(conn: sqlite3.Connection) -> bool:
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


def backfill_promoted_columns(conn: sqlite3.Connection) -> None:
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


def _disk_mime(path: str) -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def _mime_to_media_type(mime: str) -> str:
    return "video" if mime.startswith("video/") else "image"


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

        conn.execute(
            "UPDATE media_items SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (_metadata_json(metadata), row["id"]),
        )


def _backfill_embedding_mime_type_in_json(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, metadata_json FROM media_items").fetchall()
    for row in rows:
        metadata = json.loads(row["metadata_json"])
        asset = metadata.get("asset")
        if not isinstance(asset, dict):
            continue
        if isinstance(asset.get("embedding_mime_type"), str):
            continue
        mime = asset.get("mime_type")
        if not isinstance(mime, str) or not mime:
            continue
        asset["embedding_mime_type"] = mime
        conn.execute(
            "UPDATE media_items SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (_metadata_json(metadata), row["id"]),
        )
