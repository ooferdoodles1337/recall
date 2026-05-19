from __future__ import annotations

import argparse
import logging
import mimetypes
from pathlib import Path

from dotenv import load_dotenv

import config
from services.catalog import db as catalog
from services.catalog import extractor as metadata_svc
from services.catalog import schema as metadata_schema
from services.pipeline.media import classify_extension, generate_thumbnail

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _guess_mime_type(path: Path, media_type: str) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    return "image/jpeg" if media_type == "image" else "video/mp4"


def _refresh_thumbnail(file_id: str, path: Path, media_type: str) -> str:
    thumbnail_bytes = generate_thumbnail(str(path), media_type)
    config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    thumbnail_abs = config.THUMBS_DIR / f"{file_id}.webp"
    thumbnail_abs.write_bytes(thumbnail_bytes)
    return str(thumbnail_abs.relative_to(config.DATA_DIR))


def refresh_catalog(
    *,
    catalog_db_path: str | None = None,
    extract: bool = False,
    regenerate_thumbnails: bool = False,
    reverse_geocode: bool = False,
    dry_run: bool = False,
) -> dict[str, int]:
    """Rewrite SQLite metadata using local data only.

    This does not call Gemini, does not create embeddings, and does not touch ChromaDB.
    """
    catalog.configure(catalog_db_path)
    items = catalog.get_all_items_with_metadata()
    stats = {"total": len(items), "updated": 0, "unchanged": 0, "missing_files": 0, "failed": 0}

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
        thumbnail_path = metadata_schema.thumbnail_path(existing)

        try:
            if regenerate_thumbnails and file_exists:
                thumbnail_path = _refresh_thumbnail(item_id, abs_path, media_type)

            extracted = (
                metadata_svc.extract(str(abs_path), reverse_geocode=reverse_geocode)
                if extract and file_exists
                else {}
            )
            rebuilt = metadata_schema.rebuild_metadata(
                path=rel_path,
                filename=filename,
                mime_type=mime_type,
                media_type=media_type,
                existing_metadata=existing,
                extracted_metadata=extracted,
                thumbnail_path=thumbnail_path,
            )

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
        "catalog refresh complete: %s=%d unchanged=%d missing_files=%d failed=%d total=%d",
        action,
        stats["updated"],
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
        help="Resolve GPS coordinates to place names during --extract (uses Nominatim/OpenStreetMap)",
    )
    parser.add_argument(
        "--regenerate-thumbnails",
        action="store_true",
        help="Regenerate local WebP thumbnails while refreshing metadata",
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
        dry_run=args.dry_run,
    )
