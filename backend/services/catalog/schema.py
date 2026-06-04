from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

from services.utils.coerce import as_float as _as_float, as_int as _as_int

SCHEMA_VERSION = 2
EMBEDDING_MODEL = "gemini-embedding-2"
EMBEDDING_DIMENSIONS = 3072

Scalar = str | int | float | bool

_PROMOTED_METADATA_KEYS = {
    "content_hash",
    "thumbnail_path",
    "animated_thumbnail_path",
    "display_path",
    "description",
    "search_terms",
    "width",
    "height",
    "duration_s",
    "taken_at",
    "taken_date",
    "taken_year_month",
    "taken_sort",
    "taken_source",
    "geo_city",
    "geo_state",
    "geo_country",
    "geo_country_code",
    "embedding_mime_type",
    "file_size",
    "file_mtime_ns",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _scalar_dict(values: dict[str, Any]) -> dict[str, Scalar]:
    return {
        str(key): value
        for key, value in values.items()
        if isinstance(value, (str, int, float, bool))
    }


def _search_phrases_from_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = [value]
    if not isinstance(value, list):
        return []

    phrases: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        phrase = item.strip()
        key = phrase.lower()
        if phrase and key not in seen:
            seen.add(key)
            phrases.append(phrase)
    return phrases


def safety_from_detection(detection: dict[str, Any] | None) -> dict[str, Any]:
    if not detection:
        return {"state": "unknown"}

    state = str(detection.get("state") or "unknown")
    safety: dict[str, Any] = {"state": state}

    nsfw_score = _as_float(detection.get("nsfw_score"))
    if nsfw_score is not None:
        safety["score"] = nsfw_score

    model = detection.get("model")
    if isinstance(model, str) and model:
        safety["model"] = model

    safety["checked_at"] = _now_iso()
    return safety


def build_metadata(
    *,
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    embedding_mime_type: str | None = None,
    extra_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the structured catalog metadata document from extracted flat metadata."""
    extra = copy.deepcopy(extra_metadata or {})
    if isinstance(extra.get("system"), dict) and extra.get("system", {}).get("schema_version") == SCHEMA_VERSION:
        return extra
    if embedding_mime_type is None and isinstance(extra.get("embedding_mime_type"), str):
        embedding_mime_type = extra["embedding_mime_type"]

    extracted = _scalar_dict({
        key: value
        for key, value in extra.items()
        if key not in _PROMOTED_METADATA_KEYS
    })

    thumbnail_path = extra.get("thumbnail_path")
    animated_thumbnail_path = extra.get("animated_thumbnail_path")
    display_path = extra.get("display_path")
    content_hash = extra.get("content_hash")

    asset_paths: dict[str, str] = {"original": path}
    if isinstance(thumbnail_path, str) and thumbnail_path:
        asset_paths["thumbnail"] = thumbnail_path
    if isinstance(animated_thumbnail_path, str) and animated_thumbnail_path:
        asset_paths["animated_thumbnail"] = animated_thumbnail_path
    if isinstance(display_path, str) and display_path:
        asset_paths["display"] = display_path

    asset: dict[str, Any] = {
        "filename": filename,
        "mime_type": mime_type,
        "media_type": media_type,
        "paths": asset_paths,
    }
    asset["embedding_mime_type"] = embedding_mime_type or mime_type
    width = _as_int(extra.get("width"))
    height = _as_int(extra.get("height"))
    duration = _as_float(extra.get("duration_s"))
    if width is not None:
        asset["width"] = width
    if height is not None:
        asset["height"] = height
    if duration is not None:
        asset["duration_seconds"] = round(duration, 3)

    capture: dict[str, Any] = {}
    if isinstance(extra.get("taken_at"), str):
        capture["taken_at"] = extra["taken_at"]
    if isinstance(extra.get("taken_date"), str):
        capture["date"] = extra["taken_date"]
    if isinstance(extra.get("taken_year_month"), str):
        capture["year_month"] = extra["taken_year_month"]
    if isinstance(extra.get("taken_sort"), str):
        capture["sort_key"] = extra["taken_sort"]
    if isinstance(extra.get("taken_source"), str):
        capture["source"] = extra["taken_source"]

    location: dict[str, Any] = {}
    for source_key, target_key in (
        ("geo_city", "city"),
        ("geo_state", "state"),
        ("geo_country", "country"),
        ("geo_country_code", "country_code"),
    ):
        value = extra.get(source_key)
        if isinstance(value, str) and value:
            location[target_key] = value
    lat = _as_float(extra.get("Composite_GPSLatitude"))
    lon = _as_float(extra.get("Composite_GPSLongitude"))
    if lat is not None:
        location["latitude"] = lat
    if lon is not None:
        location["longitude"] = lon
    if location:
        capture["location"] = location

    system: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "indexed_at": _now_iso(),
        "embedding": {
            "provider": "gemini",
            "model": EMBEDDING_MODEL,
            "dimensions": EMBEDDING_DIMENSIONS,
        },
    }
    file_size_value = _as_int(extra.get("file_size"))
    file_mtime_ns_value = _as_int(extra.get("file_mtime_ns"))
    if file_size_value is not None or file_mtime_ns_value is not None:
        file_state: dict[str, Any] = {}
        if file_size_value is not None:
            file_state["size"] = file_size_value
        if file_mtime_ns_value is not None:
            file_state["mtime_ns"] = file_mtime_ns_value
        system["file"] = file_state
    if isinstance(content_hash, str) and content_hash:
        system["content_hash"] = content_hash

    metadata: dict[str, Any] = {
        "asset": asset,
        "capture": capture,
        "search": {
            "description": extra.get("description") if isinstance(extra.get("description"), str) else None,
            "phrases": _search_phrases_from_value(extra.get("search_terms")),
        },
        "safety": safety_from_detection(extra.get("nsfw_detection") if isinstance(extra.get("nsfw_detection"), dict) else None),
        "organization": {
            "favorite": False,
            "folders": [],
        },
        "raw": {
            "exif": extracted,
        },
        "system": system,
    }
    return metadata


def _flat_extra_from_existing(metadata: dict[str, Any], *, include_raw: bool = True) -> dict[str, Any]:
    extra: dict[str, Any] = {}

    raw = metadata.get("raw")
    if include_raw and isinstance(raw, dict) and isinstance(raw.get("exif"), dict):
        extra.update(_scalar_dict(raw["exif"]))

    value = content_hash(metadata)
    if value:
        extra["content_hash"] = value
    value = file_size(metadata)
    if value is not None:
        extra["file_size"] = value
    value = file_mtime_ns(metadata)
    if value is not None:
        extra["file_mtime_ns"] = value

    value = thumbnail_path(metadata)
    if value:
        extra["thumbnail_path"] = value

    value = animated_thumbnail_path(metadata)
    if value:
        extra["animated_thumbnail_path"] = value

    value = display_path(metadata)
    if value:
        extra["display_path"] = value

    asset = metadata.get("asset")
    if isinstance(asset, dict):
        width = _as_int(asset.get("width"))
        height = _as_int(asset.get("height"))
        duration = _as_float(asset.get("duration_seconds"))
        value = embedding_mime_type(metadata)
        if value:
            extra["embedding_mime_type"] = value
        if width is not None:
            extra["width"] = width
        if height is not None:
            extra["height"] = height
        if duration is not None:
            extra["duration_s"] = duration

    capture = metadata.get("capture")
    if isinstance(capture, dict):
        for source_key, target_key in (
            ("taken_at", "taken_at"),
            ("date", "taken_date"),
            ("year_month", "taken_year_month"),
            ("sort_key", "taken_sort"),
            ("source", "taken_source"),
        ):
            value = capture.get(source_key)
            if isinstance(value, str) and value:
                extra[target_key] = value

        location = capture.get("location")
        if isinstance(location, dict):
            for source_key, target_key in (
                ("city", "geo_city"),
                ("state", "geo_state"),
                ("country", "geo_country"),
                ("country_code", "geo_country_code"),
                ("latitude", "Composite_GPSLatitude"),
                ("longitude", "Composite_GPSLongitude"),
            ):
                value = location.get(source_key)
                if isinstance(value, (str, int, float)) and not isinstance(value, bool):
                    extra[target_key] = value

    description = search_description(metadata)
    if description is not None:
        extra["description"] = description
    phrases = search_phrases(metadata)
    if phrases:
        extra["search_terms"] = phrases

    return extra


def rebuild_metadata(
    *,
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    existing_metadata: dict[str, Any] | None = None,
    extracted_metadata: dict[str, Any] | None = None,
    content_hash: str | None = None,
    thumbnail_path: str | None = None,
    embedding_mime_type: str | None = None,
) -> dict[str, Any]:
    """Rebuild structured metadata without requiring a new embedding or annotation."""
    existing = copy.deepcopy(existing_metadata or {})
    has_fresh_extraction = extracted_metadata is not None
    extra = _flat_extra_from_existing(existing, include_raw=not has_fresh_extraction)
    if has_fresh_extraction:
        extra.update(_scalar_dict(extracted_metadata or {}))

    if content_hash:
        extra["content_hash"] = content_hash
    if thumbnail_path:
        extra["thumbnail_path"] = thumbnail_path
    if embedding_mime_type:
        extra["embedding_mime_type"] = embedding_mime_type

    rebuilt = build_metadata(
        path=path,
        filename=filename,
        mime_type=mime_type,
        media_type=media_type,
        extra_metadata=extra,
    )

    search = existing.get("search")
    if isinstance(search, dict) and isinstance(search.get("annotation"), dict):
        rebuilt.setdefault("search", {})["annotation"] = copy.deepcopy(search["annotation"])

    safety = existing.get("safety")
    if isinstance(safety, dict) and has_safety_detection(existing):
        rebuilt["safety"] = copy.deepcopy(safety)

    organization = existing.get("organization")
    if isinstance(organization, dict):
        rebuilt["organization"] = copy.deepcopy(organization)

    system = existing.get("system")
    if isinstance(system, dict):
        if isinstance(system.get("indexed_at"), str):
            rebuilt["system"]["indexed_at"] = system["indexed_at"]
        if isinstance(system.get("embedding"), dict):
            rebuilt["system"]["embedding"] = copy.deepcopy(system["embedding"])

    return rebuilt


def response_links(file_id: str, metadata: dict[str, Any]) -> dict[str, str]:
    links = {"media": f"/media/{file_id}"}
    if thumbnail_path(metadata):
        links["thumbnail"] = f"/media/{file_id}/thumbnail"
    if animated_thumbnail_path(metadata):
        links["animated_thumbnail"] = f"/media/{file_id}/animated-thumbnail"
    if display_path(metadata):
        links["display"] = f"/media/{file_id}/display"
    return links


def merge_metadata(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Deep-merge metadata patches. Dicts merge recursively; other values replace."""
    result = copy.deepcopy(base)

    def merge(target: dict[str, Any], incoming: dict[str, Any]) -> None:
        for key, value in incoming.items():
            if isinstance(value, dict) and isinstance(target.get(key), dict):
                merge(target[key], value)
            else:
                target[key] = copy.deepcopy(value)

    merge(result, patch)
    return result


def annotation_patch(
    *,
    description: str,
    phrases: list[str],
    provider: str,
    model: str,
) -> dict[str, Any]:
    return {
        "search": {
            "description": description,
            "phrases": _search_phrases_from_value(phrases),
            "annotation": {
                "provider": provider,
                "model": model,
                "updated_at": _now_iso(),
            },
        }
    }


def nsfw_patch(detection: dict[str, Any]) -> dict[str, Any]:
    return {"safety": safety_from_detection(detection)}


def _asset_path(metadata: dict[str, Any], key: str) -> str | None:
    paths = metadata.get("asset", {}).get("paths") if isinstance(metadata.get("asset"), dict) else None
    if not isinstance(paths, dict):
        return None
    value = paths.get(key)
    return value if isinstance(value, str) else None


def _asset_str(metadata: dict[str, Any], key: str) -> str | None:
    asset = metadata.get("asset")
    if not isinstance(asset, dict):
        return None
    value = asset.get(key)
    return value if isinstance(value, str) else None


def asset_path(metadata: dict[str, Any]) -> str | None:
    return _asset_path(metadata, "original")


def thumbnail_path(metadata: dict[str, Any]) -> str | None:
    return _asset_path(metadata, "thumbnail")


def animated_thumbnail_path(metadata: dict[str, Any]) -> str | None:
    return _asset_path(metadata, "animated_thumbnail")


def display_path(metadata: dict[str, Any]) -> str | None:
    return _asset_path(metadata, "display")


def filename(metadata: dict[str, Any]) -> str | None:
    return _asset_str(metadata, "filename")


def mime_type(metadata: dict[str, Any]) -> str | None:
    return _asset_str(metadata, "mime_type")


def embedding_mime_type(metadata: dict[str, Any]) -> str | None:
    return _asset_str(metadata, "embedding_mime_type")


def media_type(metadata: dict[str, Any]) -> str | None:
    return _asset_str(metadata, "media_type")


def content_hash(metadata: dict[str, Any]) -> str | None:
    system = metadata.get("system")
    if not isinstance(system, dict):
        return None
    value = system.get("content_hash")
    return value if isinstance(value, str) else None


def file_size(metadata: dict[str, Any]) -> int | None:
    system = metadata.get("system")
    file_state = system.get("file") if isinstance(system, dict) else None
    if not isinstance(file_state, dict):
        return None
    return _as_int(file_state.get("size"))


def file_mtime_ns(metadata: dict[str, Any]) -> int | None:
    system = metadata.get("system")
    file_state = system.get("file") if isinstance(system, dict) else None
    if not isinstance(file_state, dict):
        return None
    return _as_int(file_state.get("mtime_ns"))


def taken_sort(metadata: dict[str, Any]) -> str | None:
    capture = metadata.get("capture")
    if not isinstance(capture, dict):
        return None
    value = capture.get("sort_key")
    return value if isinstance(value, str) else None


def taken_date(metadata: dict[str, Any]) -> str | None:
    capture = metadata.get("capture")
    if not isinstance(capture, dict):
        return None
    value = capture.get("date")
    return value if isinstance(value, str) else None


def taken_year_month(metadata: dict[str, Any]) -> str | None:
    capture = metadata.get("capture")
    if not isinstance(capture, dict):
        return None
    value = capture.get("year_month")
    return value if isinstance(value, str) else None


def search_description(metadata: dict[str, Any]) -> str | None:
    search = metadata.get("search")
    if not isinstance(search, dict):
        return None
    value = search.get("description")
    return value if isinstance(value, str) else None


def search_phrases(metadata: dict[str, Any]) -> list[str]:
    search = metadata.get("search")
    if not isinstance(search, dict):
        return []
    return _search_phrases_from_value(search.get("phrases"))


def has_safety_detection(metadata: dict[str, Any]) -> bool:
    safety = metadata.get("safety")
    if not isinstance(safety, dict):
        return False
    return safety.get("state") not in {None, "unknown"}
