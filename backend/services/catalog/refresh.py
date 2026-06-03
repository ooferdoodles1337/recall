from __future__ import annotations

import argparse
import copy
import logging
import mimetypes
from pathlib import Path
from dotenv import load_dotenv

import config
from services.catalog import db as catalog
from services.catalog import extractor as metadata_svc
from services.catalog.extractor import infer_date_from_filename
from services.catalog import schema as metadata_schema
from services.utils.coerce import as_float as _as_float
from services.pipeline.media import classify_extension, generate_thumbnail, is_animated

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _guess_mime_type(path: Path, media_type: str) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    return "image/jpeg" if media_type == "image" else "video/mp4"


def _embedding_mime_type(path: Path, media_type: str, *, file_exists: bool) -> str | None:
    ext = path.suffix.lower()
    if media_type == "video":
        return "video/mp4"
    if media_type != "image":
        return None
    if ext in {".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp"}:
        return "image/jpeg"
    if ext in {".png", ".apng"}:
        if file_exists and is_animated(str(path)):
            return "video/mp4"
        return "image/png"
    if ext == ".gif":
        if not file_exists:
            return None
        return "video/mp4" if is_animated(str(path)) else "image/jpeg"
    if file_exists:
        return "image/jpeg"
    return None


def _refresh_thumbnail(file_id: str, path: Path, media_type: str) -> str:
    thumbnail_bytes = generate_thumbnail(str(path), media_type)
    config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    thumbnail_abs = config.THUMBS_DIR / f"{file_id}.webp"
    thumbnail_abs.write_bytes(thumbnail_bytes)
    return str(thumbnail_abs.relative_to(config.DATA_DIR))


def _existing_coordinates(metadata: dict) -> tuple[float | None, float | None]:
    capture = metadata.get("capture")
    location = capture.get("location") if isinstance(capture, dict) else None
    if isinstance(location, dict):
        lat = _as_float(location.get("latitude"))
        lon = _as_float(location.get("longitude"))
        if lat is not None and lon is not None:
            return lat, lon

    raw = metadata.get("raw")
    exif = raw.get("exif") if isinstance(raw, dict) else None
    if not isinstance(exif, dict):
        return None, None
    return _as_float(exif.get("Composite_GPSLatitude")), _as_float(exif.get("Composite_GPSLongitude"))


def _with_reverse_geocode(metadata: dict) -> tuple[dict, bool]:
    lat, lon = _existing_coordinates(metadata)
    if lat is None or lon is None:
        return metadata, False

    geo = metadata_svc.reverse_geocode_coords(lat, lon)
    if not geo:
        return metadata, False

    updated = copy.deepcopy(metadata)
    capture = updated.setdefault("capture", {})
    if not isinstance(capture, dict):
        capture = {}
        updated["capture"] = capture
    location = capture.setdefault("location", {})
    if not isinstance(location, dict):
        location = {}
        capture["location"] = location

    changed = False
    for source_key, target_key in (
        ("geo_city", "city"),
        ("geo_state", "state"),
        ("geo_country", "country"),
        ("geo_country_code", "country_code"),
    ):
        value = geo.get(source_key)
        if isinstance(value, str) and value and location.get(target_key) != value:
            location[target_key] = value
            changed = True

    if location.get("latitude") != lat:
        location["latitude"] = lat
        changed = True
    if location.get("longitude") != lon:
        location["longitude"] = lon
        changed = True

    return updated, changed


def refresh_catalog(
    *,
    catalog_db_path: str | None = None,
    extract: bool = False,
    regenerate_thumbnails: bool = False,
    reverse_geocode: bool = False,
    infer_dates: bool = False,
    dry_run: bool = False,
) -> dict[str, int]:
    """Rewrite SQLite metadata using local data only.

    This does not call Gemini, does not create embeddings, and does not touch ChromaDB.
    """
    catalog.configure(catalog_db_path)
    items = catalog.get_all_items_with_metadata()
    stats = {"total": len(items), "updated": 0, "geocoded": 0, "dates_inferred": 0, "unchanged": 0, "missing_files": 0, "failed": 0}

    for item in items:
        item_id = item["id"]
        existing = item["metadata"] or {}
        rel_path = metadata_schema.asset_path(existing)
        if not rel_path:
            log.error("skipped %s: missing original media path", item_id)
            stats["failed"] += 1
            continue

        abs_path = config.DATA_DIR / rel_path
        file_exists = abs_path.is_file()
        if not file_exists:
            stats["missing_files"] += 1
            if extract or regenerate_thumbnails:
                log.warning("media file missing for %s, preserving stored local metadata: %s", item_id, abs_path)

        detected_media_type = classify_extension(abs_path.suffix)
        media_type = metadata_schema.media_type(existing) or detected_media_type
        if media_type not in {"image", "video"}:
            log.error("skipped %s: unsupported or missing media type for %s", item_id, rel_path)
            stats["failed"] += 1
            continue

        filename = metadata_schema.filename(existing) or abs_path.name
        mime_type = metadata_schema.mime_type(existing) or _guess_mime_type(abs_path, media_type)
        embedding_mime_type = _embedding_mime_type(abs_path, media_type, file_exists=file_exists)
        thumbnail_path = metadata_schema.thumbnail_path(existing)

        try:
            if regenerate_thumbnails and file_exists:
                thumbnail_path = _refresh_thumbnail(item_id, abs_path, media_type)

            extracted = metadata_svc.extract(str(abs_path), reverse_geocode=reverse_geocode) if extract and file_exists else None
            rebuilt = metadata_schema.rebuild_metadata(
                path=rel_path,
                filename=filename,
                mime_type=mime_type,
                media_type=media_type,
                existing_metadata=existing,
                extracted_metadata=extracted,
                thumbnail_path=thumbnail_path,
                embedding_mime_type=embedding_mime_type,
            )
            if reverse_geocode:
                rebuilt, geocoded = _with_reverse_geocode(rebuilt)
                if geocoded:
                    stats["geocoded"] += 1

            if infer_dates:
                current_source = (rebuilt.get("capture") or {}).get("source", "")
                if current_source in ("filesystem_mtime", "unknown", ""):
                    inferred = infer_date_from_filename(str(abs_path))
                    if inferred:
                        capture = rebuilt.setdefault("capture", {})
                        capture["taken_at"] = inferred["taken_at"]
                        capture["date"] = inferred["taken_date"]
                        capture["year_month"] = inferred["taken_year_month"]
                        capture["sort_key"] = inferred["taken_sort"]
                        capture["source"] = inferred["taken_source"]
                        stats["dates_inferred"] += 1

            if rebuilt == existing:
                stats["unchanged"] += 1
                continue

            if dry_run:
                log.info("would refresh metadata: %s", item_id)
            else:
                catalog.replace_metadata(item_id, rebuilt)
                log.info("refreshed metadata: %s", item_id)
            stats["updated"] += 1
        except Exception as exc:
            log.error("failed refreshing %s (%s): %s", item_id, type(exc).__name__, exc)
            stats["failed"] += 1

    action = "would refresh" if dry_run else "refreshed"
    log.info(
        "catalog refresh complete: %s=%d geocoded=%d dates_inferred=%d unchanged=%d missing_files=%d failed=%d total=%d",
        action,
        stats["updated"],
        stats["geocoded"],
        stats["dates_inferred"],
        stats["unchanged"],
        stats["missing_files"],
        stats["failed"],
        stats["total"],
    )
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Refresh SQLite catalog metadata without Gemini or ChromaDB work")
    parser.add_argument(
        "--catalog-db-path",
        default=None,
        help=f"Path to SQLite catalog database (default: {config.CATALOG_DB_PATH})",
    )
    parser.add_argument(
        "--extract",
        action="store_true",
        help="Re-run local ExifTool metadata extraction before rebuilding metadata",
    )
    parser.add_argument(
        "--reverse-geocode",
        action="store_true",
        help="Resolve stored GPS coordinates to place names while preserving media, thumbnails, embeddings, and annotations",
    )
    parser.add_argument(
        "--regenerate-thumbnails",
        action="store_true",
        help="Regenerate local WebP thumbnails while refreshing metadata",
    )
    parser.add_argument(
        "--infer-dates",
        action="store_true",
        help="Infer capture date from filename for items that lack EXIF date (Unix-ms/μs timestamps, YYYYMMDD_HHMMSS)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report which rows would change without writing to SQLite",
    )
    args = parser.parse_args()
    refresh_catalog(
        catalog_db_path=args.catalog_db_path,
        extract=args.extract,
        regenerate_thumbnails=args.regenerate_thumbnails,
        reverse_geocode=args.reverse_geocode,
        infer_dates=args.infer_dates,
        dry_run=args.dry_run,
    )
