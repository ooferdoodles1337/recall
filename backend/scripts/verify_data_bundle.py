import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config
from services.catalog import db as catalog
from services.catalog import schema as metadata_schema
from services.search import chroma

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _is_portable_relative(path_value: str) -> bool:
    path = Path(path_value)
    return bool(path_value) and not path.is_absolute() and ".." not in path.parts


def _collection_ids() -> set[str]:
    collection = chroma.content_collection
    if collection is None:
        chroma.configure()
        collection = chroma.content_collection
    assert collection is not None

    count = collection.count()
    if count == 0:
        return set()
    result = collection.get(limit=count, include=[])
    return set(result["ids"])


def verify_bundle(
    *,
    catalog_db_path: str | None = None,
    chroma_db_path: str | None = None,
    require_annotations: bool = False,
    require_safety: bool = False,
) -> int:
    catalog.configure(catalog_db_path)
    chroma.configure(chroma_db_path)

    errors: list[str] = []
    warnings: list[str] = []
    items = catalog.get_all_items_with_metadata()
    catalog_ids = {item["id"] for item in items}
    chroma_ids = _collection_ids()

    if not items:
        errors.append("catalog is empty")
    if not config.CATALOG_DB_PATH.is_file() and catalog_db_path is None:
        errors.append(f"catalog database is missing: {config.CATALOG_DB_PATH}")
    if not config.DB_PATH.exists() and chroma_db_path is None:
        errors.append(f"ChromaDB directory is missing: {config.DB_PATH}")

    missing_vectors = catalog_ids - chroma_ids
    extra_vectors = chroma_ids - catalog_ids
    if missing_vectors:
        errors.append(f"{len(missing_vectors)} catalog items are missing Chroma vectors")
    if extra_vectors:
        errors.append(f"{len(extra_vectors)} Chroma vectors are not present in the catalog")

    seen_hashes: set[str] = set()
    for item in items:
        item_id = item["id"]
        meta = item["metadata"] or {}

        media_path = metadata_schema.asset_path(meta)
        if not media_path or not _is_portable_relative(media_path):
            errors.append(f"{item_id} has a non-portable media path: {media_path!r}")
        elif not (config.DATA_DIR / media_path).is_file():
            errors.append(f"{item_id} media file is missing: {media_path}")

        thumbnail_path = metadata_schema.thumbnail_path(meta)
        if not thumbnail_path or not _is_portable_relative(thumbnail_path):
            errors.append(f"{item_id} has a non-portable thumbnail path: {thumbnail_path!r}")
        elif not (config.DATA_DIR / thumbnail_path).is_file():
            errors.append(f"{item_id} thumbnail file is missing: {thumbnail_path}")

        content_hash = metadata_schema.content_hash(meta)
        if not content_hash:
            errors.append(f"{item_id} is missing content_hash")
        elif content_hash in seen_hashes:
            errors.append(f"{item_id} has duplicate content_hash: {content_hash}")
        else:
            seen_hashes.add(content_hash)

        if not metadata_schema.mime_type(meta):
            errors.append(f"{item_id} is missing mime_type")
        if metadata_schema.media_type(meta) not in {"image", "video"}:
            errors.append(f"{item_id} has unexpected media_type: {metadata_schema.media_type(meta)!r}")

        if require_annotations and not metadata_schema.search_description(meta):
            errors.append(f"{item_id} is missing annotation description")
        if require_safety and not metadata_schema.has_safety_detection(meta):
            errors.append(f"{item_id} is missing safety detection")

    for message in warnings:
        log.warning(message)
    for message in errors[:50]:
        log.error(message)
    if len(errors) > 50:
        log.error("...and %d more errors", len(errors) - 50)

    log.info(
        "bundle verification summary: catalog_items=%d chroma_vectors=%d errors=%d warnings=%d",
        len(items),
        len(chroma_ids),
        len(errors),
        len(warnings),
    )
    return 1 if errors else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify backend/data can be distributed as a portable Recall data bundle")
    parser.add_argument("--catalog-db-path", default=None, help=f"Catalog SQLite path (default: {config.CATALOG_DB_PATH})")
    parser.add_argument("--chroma-db-path", default=None, help=f"ChromaDB path (default: {config.DB_PATH})")
    parser.add_argument("--require-annotations", action="store_true", help="Fail if any item lacks Gemini annotation text")
    parser.add_argument("--require-safety", action="store_true", help="Fail if any item lacks NSFW detection metadata")
    args = parser.parse_args()
    raise SystemExit(
        verify_bundle(
            catalog_db_path=args.catalog_db_path,
            chroma_db_path=args.chroma_db_path,
            require_annotations=args.require_annotations,
            require_safety=args.require_safety,
        )
    )


if __name__ == "__main__":
    main()
