"""Row-to-dict serialization and metadata↔column helpers for the catalog DB.

Internal module — do not import outside of services/catalog/db.py.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from services.catalog import schema as metadata_schema
from services.utils.coerce import as_float as _as_float, as_int as _as_int

_PROMOTED_COLUMN_DEFS: dict[str, str] = {
    "asset_path": "TEXT",
    "thumbnail_path": "TEXT",
    "animated_thumbnail_path": "TEXT",
    "display_path": "TEXT",
    "filename": "TEXT",
    "mime_type": "TEXT",
    "embedding_mime_type": "TEXT",
    "file_size": "INTEGER",
    "file_mtime_ns": "INTEGER",
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


# ---------------------------------------------------------------------------
# Metadata substructure helpers
# ---------------------------------------------------------------------------

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


def _capture_str(metadata: dict, key: str) -> str | None:
    capture = metadata.get("capture")
    if isinstance(capture, dict) and isinstance(capture.get(key), str):
        return capture[key]
    return None


def _asset_number(metadata: dict, key: str, *, integer: bool) -> int | float | None:
    asset = metadata.get("asset")
    if not isinstance(asset, dict):
        return None
    return _as_int(asset.get(key)) if integer else _as_float(asset.get(key))


def _dict_str(data: dict, key: str) -> str | None:
    value = data.get(key)
    return value if isinstance(value, str) else None


# ---------------------------------------------------------------------------
# Metadata → promoted column values
# ---------------------------------------------------------------------------

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
        "animated_thumbnail_path": metadata_schema.animated_thumbnail_path(metadata),
        "display_path": metadata_schema.display_path(metadata),
        "filename": metadata_schema.filename(metadata),
        "mime_type": metadata_schema.mime_type(metadata),
        "embedding_mime_type": metadata_schema.embedding_mime_type(metadata),
        "file_size": metadata_schema.file_size(metadata),
        "file_mtime_ns": metadata_schema.file_mtime_ns(metadata),
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


def _promoted_params(metadata: dict) -> tuple[Any, ...]:
    values = _promoted_values(metadata)
    return tuple(values[column] for column in _PROMOTED_COLUMNS)


def _metadata_json(metadata: dict) -> str:
    return json.dumps(metadata, sort_keys=True)


# ---------------------------------------------------------------------------
# SQLite row → response dict
# ---------------------------------------------------------------------------

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


def row_to_item(row: sqlite3.Row) -> dict:
    item_id = row["id"]
    metadata = json.loads(row["metadata_json"])
    return {
        "id": item_id,
        "metadata": metadata,
        "links": metadata_schema.response_links(item_id, metadata),
    }


def row_to_stored_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "metadata": json.loads(row["metadata_json"]),
    }


def row_to_summary_item(row: sqlite3.Row) -> dict:
    item_id = row["id"]
    asset_paths: dict[str, str] = {}
    if row["asset_path"]:
        asset_paths["original"] = row["asset_path"]
    if row["thumbnail_path"]:
        asset_paths["thumbnail"] = row["thumbnail_path"]
    if row["animated_thumbnail_path"]:
        asset_paths["animated_thumbnail"] = row["animated_thumbnail_path"]
    if row["display_path"]:
        asset_paths["display"] = row["display_path"]

    asset: dict[str, Any] = {
        "filename": row["filename"],
        "mime_type": row["mime_type"],
        "embedding_mime_type": row["embedding_mime_type"],
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


# ---------------------------------------------------------------------------
# Metadata → storage format
# ---------------------------------------------------------------------------

def metadata_for_storage(
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
