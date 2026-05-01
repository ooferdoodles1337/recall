from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

SCHEMA_VERSION = 2
EMBEDDING_MODEL = "gemini-embedding-2"
EMBEDDING_DIMENSIONS = 3072

Scalar = str | int | float | bool

_PROMOTED_METADATA_KEYS = {
    "content_hash",
    "thumbnail_path",
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
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _scalar_dict(values: dict[str, Any]) -> dict[str, Scalar]:
    return {
        str(key): value
        for key, value in values.items()
        if isinstance(value, (str, int, float, bool))
    }


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


def _safety_from_detection(detection: dict[str, Any] | None) -> dict[str, Any]:
    if not detection:
        return {"state": "unknown"}

    label = str(detection.get("label") or "").strip().lower()
    if label == "safe":
        state = "safe"
    elif label == "nsfw":
        state = "nsfw"
    elif label:
        state = "sensitive"
    else:
        state = "unknown"

    safety: dict[str, Any] = {"state": state}
    score = _as_float(detection.get("score"))
    if score is not None:
        safety["score"] = score

    probabilities = detection.get("probabilities")
    if isinstance(probabilities, dict):
        labels = {
            str(key): float(value)
            for key, value in probabilities.items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        }
        if labels:
            safety["labels"] = labels

    model = detection.get("model")
    if isinstance(model, str) and model:
        safety["provider"] = "local"
        safety["model"] = model
    safety["checked_at"] = _now_iso()
    return safety


def build_metadata(
    *,
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
    extra_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the structured catalog metadata document from extracted flat metadata."""
    extra = copy.deepcopy(extra_metadata or {})
    if isinstance(extra.get("system"), dict) and extra.get("system", {}).get("schema_version") == SCHEMA_VERSION:
        return extra

    extracted = _scalar_dict({
        key: value
        for key, value in extra.items()
        if key not in _PROMOTED_METADATA_KEYS
    })

    thumbnail_path = extra.get("thumbnail_path")
    content_hash = extra.get("content_hash")

    asset_paths: dict[str, str] = {"original": path}
    if isinstance(thumbnail_path, str) and thumbnail_path:
        asset_paths["thumbnail"] = thumbnail_path

    asset: dict[str, Any] = {
        "filename": filename,
        "mime_type": mime_type,
        "media_type": media_type,
        "paths": asset_paths,
    }
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

    metadata: dict[str, Any] = {
        "asset": asset,
        "capture": capture,
        "search": {
            "description": extra.get("description") if isinstance(extra.get("description"), str) else None,
            "phrases": _search_phrases_from_value(extra.get("search_terms")),
        },
        "safety": _safety_from_detection(extra.get("nsfw_detection") if isinstance(extra.get("nsfw_detection"), dict) else None),
        "organization": {
            "favorite": False,
            "folders": [],
        },
        "raw": {
            "exif": extracted,
        },
        "system": {
            "schema_version": SCHEMA_VERSION,
            "indexed_at": _now_iso(),
            "embedding": {
                "provider": "gemini",
                "model": EMBEDDING_MODEL,
                "dimensions": EMBEDDING_DIMENSIONS,
            },
        },
    }
    if isinstance(content_hash, str) and content_hash:
        metadata["system"]["content_hash"] = content_hash
    return metadata


def response_links(file_id: str, metadata: dict[str, Any]) -> dict[str, str]:
    links = {"media": f"/media/{file_id}"}
    if thumbnail_path(metadata):
        links["thumbnail"] = f"/media/{file_id}/thumbnail"
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
    return {"safety": _safety_from_detection(detection)}


def asset_path(metadata: dict[str, Any]) -> str | None:
    paths = metadata.get("asset", {}).get("paths") if isinstance(metadata.get("asset"), dict) else None
    if isinstance(paths, dict) and isinstance(paths.get("original"), str):
        return paths["original"]
    value = metadata.get("path")
    return value if isinstance(value, str) else None


def thumbnail_path(metadata: dict[str, Any]) -> str | None:
    paths = metadata.get("asset", {}).get("paths") if isinstance(metadata.get("asset"), dict) else None
    if isinstance(paths, dict) and isinstance(paths.get("thumbnail"), str):
        return paths["thumbnail"]
    value = metadata.get("thumbnail_path")
    return value if isinstance(value, str) else None


def filename(metadata: dict[str, Any]) -> str | None:
    asset = metadata.get("asset")
    if isinstance(asset, dict) and isinstance(asset.get("filename"), str):
        return asset["filename"]
    value = metadata.get("filename")
    return value if isinstance(value, str) else None


def mime_type(metadata: dict[str, Any]) -> str | None:
    asset = metadata.get("asset")
    if isinstance(asset, dict) and isinstance(asset.get("mime_type"), str):
        return asset["mime_type"]
    value = metadata.get("mime_type")
    return value if isinstance(value, str) else None


def media_type(metadata: dict[str, Any]) -> str | None:
    asset = metadata.get("asset")
    if isinstance(asset, dict) and isinstance(asset.get("media_type"), str):
        return asset["media_type"]
    value = metadata.get("media_type")
    return value if isinstance(value, str) else None


def content_hash(metadata: dict[str, Any]) -> str | None:
    system = metadata.get("system")
    if isinstance(system, dict) and isinstance(system.get("content_hash"), str):
        return system["content_hash"]
    value = metadata.get("content_hash")
    return value if isinstance(value, str) else None


def taken_sort(metadata: dict[str, Any]) -> str | None:
    capture = metadata.get("capture")
    if isinstance(capture, dict) and isinstance(capture.get("sort_key"), str):
        return capture["sort_key"]
    value = metadata.get("taken_sort")
    return value if isinstance(value, str) else None


def taken_date(metadata: dict[str, Any]) -> str | None:
    capture = metadata.get("capture")
    if isinstance(capture, dict) and isinstance(capture.get("date"), str):
        return capture["date"]
    value = metadata.get("taken_date")
    return value if isinstance(value, str) else None


def taken_year_month(metadata: dict[str, Any]) -> str | None:
    capture = metadata.get("capture")
    if isinstance(capture, dict) and isinstance(capture.get("year_month"), str):
        return capture["year_month"]
    value = metadata.get("taken_year_month")
    return value if isinstance(value, str) else None


def search_description(metadata: dict[str, Any]) -> str | None:
    search = metadata.get("search")
    if isinstance(search, dict) and isinstance(search.get("description"), str):
        return search["description"]
    value = metadata.get("description")
    return value if isinstance(value, str) else None


def search_phrases(metadata: dict[str, Any]) -> list[str]:
    search = metadata.get("search")
    if isinstance(search, dict):
        return _search_phrases_from_value(search.get("phrases"))
    return _search_phrases_from_value(metadata.get("search_terms"))


def has_safety_detection(metadata: dict[str, Any]) -> bool:
    safety = metadata.get("safety")
    if isinstance(safety, dict):
        return safety.get("state") not in {None, "unknown"} or bool(safety.get("labels"))
    return isinstance(metadata.get("nsfw_detection"), dict)
