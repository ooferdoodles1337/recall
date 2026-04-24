from __future__ import annotations

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


def _reverse_geocode(lat: float, lon: float) -> dict[str, str]:
    try:
        geocoder = Nominatim(user_agent="recall-indexer")
        location = geocoder.reverse((lat, lon), language="en", timeout=5)
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

    return result
