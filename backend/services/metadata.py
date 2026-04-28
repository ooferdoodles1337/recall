from __future__ import annotations

import functools
import logging
from typing import Any

import exiftool
from geopy.exc import GeocoderServiceError, GeocoderTimedOut
from geopy.geocoders import Nominatim

log = logging.getLogger(__name__)


def _sanitize_key(key: str) -> str:
    return key.replace(":", "_").replace(" ", "_").replace("-", "_")


def _sanitize_value(value: Any) -> str | int | float | bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value
    return None


def _first_int(result: dict, keys: list[str]) -> int | None:
    for key in keys:
        val = result.get(key)
        if isinstance(val, int):
            return val
        if isinstance(val, float):
            return int(val)
        if isinstance(val, str):
            try:
                return int(float(val))
            except ValueError:
                continue
    return None


_DURATION_KEYS = [
    "Duration",
    "QuickTime_Duration",
    "Track_Duration",
    "Movie_Duration",
    "Matroska_Duration",
    "RIFF_Duration",
    "ASF_Duration",
    "FLV_Duration",
]


def _parse_duration(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    value = value.strip()
    try:
        return float(value)
    except ValueError:
        pass
    parts = value.split(":")
    if len(parts) == 2:
        try:
            mins = float(parts[0])
            secs = float(parts[1])
            return mins * 60 + secs
        except ValueError:
            return None
    if len(parts) == 3:
        try:
            hours = float(parts[0])
            mins = float(parts[1])
            secs = float(parts[2])
            return hours * 3600 + mins * 60 + secs
        except ValueError:
            return None
    return None


def _normalize_dimensions_and_duration(
    result: dict[str, str | int | float | bool],
) -> dict[str, str | int | float | bool]:
    # 1. Composite first, then container-specific, then EXIF/File
    width = _first_int(
        result,
        [
            "Composite_ImageWidth",
            "ImageWidth",
            "QuickTime_ImageWidth",
            "Track_ImageWidth",
            "Matroska_ImageWidth",
            "RIFF_ImageWidth",
            "ASF_ImageWidth",
            "FLV_ImageWidth",
            "EXIF_ImageWidth",
            "EXIF_ExifImageWidth",
            "File_ImageWidth",
        ],
    )
    height = _first_int(
        result,
        [
            "Composite_ImageHeight",
            "ImageHeight",
            "QuickTime_ImageHeight",
            "Track_ImageHeight",
            "Matroska_ImageHeight",
            "RIFF_ImageHeight",
            "ASF_ImageHeight",
            "FLV_ImageHeight",
            "EXIF_ImageHeight",
            "EXIF_ExifImageHeight",
            "File_ImageHeight",
        ],
    )

    duration = None

    # 1. Prefer Composite (already normalized by ExifTool)
    composite_val = result.get("Composite_Duration")
    if composite_val is not None:
        duration = _parse_duration(composite_val)

    # 2. Try XMP structured duration
    if duration is None:
        scale = result.get("XMP_DurationScale")
        value = result.get("XMP_DurationValue")
        if scale is not None and value is not None:
            try:
                duration = float(value) * float(scale)
            except (ValueError, TypeError):
                duration = None

    # 3. Scan remaining keys and pick the longest valid duration
    # (some tags like Track_Duration may be shorter than Movie_Duration)
    if duration is None:
        best_duration = 0.0
        for key in _DURATION_KEYS:
            val = result.get(key)
            if val is not None:
                parsed = _parse_duration(val)
                if parsed is not None and parsed > best_duration:
                    best_duration = parsed
        if best_duration > 0:
            duration = best_duration

    normalized: dict[str, str | int | float | bool] = {}
    if width is not None:
        normalized["width"] = width
    if height is not None:
        normalized["height"] = height
    if duration is not None:
        normalized["duration_s"] = round(duration, 3)
    return normalized


# Shared geocoder instance — created once at import time (no network call).
_geocoder = Nominatim(user_agent="recall-indexer")


@functools.lru_cache(maxsize=1024)
def _reverse_geocode(lat: float, lon: float) -> dict[str, str]:
    try:
        location = _geocoder.reverse((lat, lon), language="en", timeout=5)
        if location is None:
            return {}
        addr = location.raw.get("address", {})
        result: dict[str, str] = {}
        for field in ("city", "town", "village", "suburb"):
            if field in addr:
                result["geo_city"] = addr[field]
                break
        for field in ("state", "region"):
            if field in addr:
                result["geo_state"] = addr[field]
                break
        if "country" in addr:
            result["geo_country"] = addr["country"]
        if "country_code" in addr:
            result["geo_country_code"] = addr["country_code"].upper()
        return result
    except (GeocoderTimedOut, GeocoderServiceError) as exc:
        log.warning("reverse geocoding failed: %s", exc)
        return {}


def extract(path: str) -> dict[str, str | int | float | bool]:
    try:
        with exiftool.ExifToolHelper() as et:
            raw_list = et.get_metadata(path)
            raw = raw_list[0] if raw_list else {}
    except Exception as exc:
        log.warning("exiftool extraction failed for %s: %s", path, exc)
        return {}

    result: dict[str, str | int | float | bool] = {}
    for raw_key, raw_value in raw.items():
        key = _sanitize_key(raw_key)
        value = _sanitize_value(raw_value)
        if value is not None:
            result[key] = value

    lat = raw.get("Composite:GPSLatitude")
    lon = raw.get("Composite:GPSLongitude")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        result.update(_reverse_geocode(float(lat), float(lon)))

    result.update(_normalize_dimensions_and_duration(result))

    return result
