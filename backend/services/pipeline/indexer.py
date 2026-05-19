import argparse
import hashlib
import logging
import mimetypes
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

import config
from services.catalog import db as catalog
from services.catalog import extractor as metadata_svc
from services.providers import gemini
from services.search import chroma
from services.utils import format_bytes
from services.pipeline.media import (
    IMAGE_EXTENSIONS,
    classify_extension,
    generate_thumbnail,
    process_image,
    process_video,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

_NOISY_DEBUG_LOGGERS = (
    "PIL",
    "urllib3",
    "geopy",
    "chromadb",
    "posthog",
    "httpcore",
    "httpx",
    "google",
)


def _configure_log_level(level: str) -> None:
    logging.getLogger().setLevel(level)
    for logger_name in _NOISY_DEBUG_LOGGERS:
        logging.getLogger(logger_name).setLevel(logging.WARNING)


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class _PendingItem:
    file_id: str
    content_hash: str
    rel_path: str
    path: Path
    original_mime: str
    original_media_type: str
    processed_data: bytes
    processed_mime: str
    file_metadata: dict


def _original_mime_type(path: Path, media_type: str) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    return "image/jpeg" if media_type == "image" else "video/mp4"


def _preprocess_file(
    path: Path,
    force: bool,
    seen_hashes: set[str] | None = None,
    *,
    reverse_geocode: bool = True,
) -> _PendingItem | None:
    """Process a file for indexing without embedding. Returns None if the file should be skipped."""
    started_at = time.monotonic()
    ext = path.suffix.lower()
    original_media_type = classify_extension(ext)

    if original_media_type is None:
        log.warning("skipped (unsupported): %s", path)
        return None

    try:
        rel_path = str(path.relative_to(config.DATA_DIR))
    except ValueError:
        log.error("file is outside DATA_DIR and cannot be indexed portably: %s", path)
        return None

    content_hash = _file_hash(path)
    raw_size = path.stat().st_size
    log.debug(
        "preprocess start: path=%s media_type=%s raw=%s sha256=%s",
        path,
        original_media_type,
        format_bytes(raw_size),
        content_hash[:12],
    )
    if seen_hashes is not None and content_hash in seen_hashes:
        log.info("skipped (duplicate in this run): %s", path)
        return None

    existing_id = catalog.get_id_by_hash(content_hash)

    if not force and existing_id is not None:
        log.info("skipped (already indexed): %s", path)
        return None

    file_id = existing_id or str(uuid.uuid4())

    try:
        path_str = str(path)
        processed = process_image(path_str) if ext in IMAGE_EXTENSIONS else process_video(path_str)
        file_metadata = metadata_svc.extract(path_str, reverse_geocode=reverse_geocode)
        file_metadata["content_hash"] = content_hash

        thumbnail_bytes = generate_thumbnail(path_str, processed.media_type)
        config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
        thumbnail_abs = config.THUMBS_DIR / f"{file_id}.webp"
        thumbnail_abs.write_bytes(thumbnail_bytes)
        file_metadata["thumbnail_path"] = str(thumbnail_abs.relative_to(config.DATA_DIR))

        if seen_hashes is not None:
            seen_hashes.add(content_hash)

        elapsed = time.monotonic() - started_at
        log.debug(
            "preprocess complete: path=%s id=%s processed=%s mime=%s thumbnail=%s elapsed=%.1fs",
            path,
            file_id,
            format_bytes(len(processed.data)),
            processed.mime_type,
            file_metadata["thumbnail_path"],
            elapsed,
        )
        return _PendingItem(
            file_id=file_id,
            content_hash=content_hash,
            rel_path=rel_path,
            path=path,
            original_mime=_original_mime_type(path, original_media_type),
            original_media_type=original_media_type,
            processed_data=processed.data,
            processed_mime=processed.mime_type,
            file_metadata=file_metadata,
        )
    except Exception as exc:
        log.error("failed preprocessing (%s): %s", type(exc).__name__, path)
        return None


def _index_pending_batch(pending: list[_PendingItem]) -> int:
    if not pending:
        return 0

    estimated_jsonl_bytes = sum(
        gemini.estimate_embedding_request_jsonl_bytes(item.file_id, item.processed_data, item.processed_mime)
        for item in pending
    )
    media_bytes = sum(len(item.processed_data) for item in pending)
    started_at = time.monotonic()
    log.info(
        "batch embedding %d items: media=%s estimated_jsonl=%s first=%s last=%s",
        len(pending),
        format_bytes(media_bytes),
        format_bytes(estimated_jsonl_bytes),
        pending[0].path.name,
        pending[-1].path.name,
    )
    embed_inputs = [(item.file_id, item.processed_data, item.processed_mime) for item in pending]
    embeddings = gemini.embed_content_batch(embed_inputs)
    log.info(
        "batch embedding returned %d/%d vectors in %.1fs",
        len(embeddings),
        len(pending),
        time.monotonic() - started_at,
    )

    indexed = 0
    for item in pending:
        embedding = embeddings.get(item.file_id)
        if embedding is None:
            log.error("no embedding returned for: %s", item.path)
            continue
        try:
            chroma.upsert_content(
                file_id=item.file_id,
                embedding=embedding,
            )
            catalog.upsert_item(
                file_id=item.file_id,
                path=item.rel_path,
                filename=item.path.name,
                mime_type=item.original_mime,
                media_type=item.original_media_type,
                extra_metadata=item.file_metadata,
            )
            indexed += 1
            log.info("indexed: %s", item.path)
        except Exception as exc:
            log.error("failed upserting (%s): %s", type(exc).__name__, item.path)

    return indexed


def index_file(path: Path, force: bool) -> None:
    """Index a single file. Embeds immediately (no batching)."""
    item = _preprocess_file(path, force=force)
    if item is None:
        return

    try:
        content_embedding = gemini.embed_content(item.processed_data, item.processed_mime)
        chroma.upsert_content(file_id=item.file_id, embedding=content_embedding)
        catalog.upsert_item(
            file_id=item.file_id,
            path=item.rel_path,
            filename=item.path.name,
            mime_type=item.original_mime,
            media_type=item.original_media_type,
            extra_metadata=item.file_metadata,
        )
        log.info("indexed: %s", item.path)
    except Exception as exc:
        log.error("failed (%s): %s", type(exc).__name__, item.path)


def run(
    force: bool,
    annotate: bool = False,
    detect_nsfw: bool = False,
    db_path: str | None = None,
    media_dir: str | None = None,
    reset: bool = False,
    reverse_geocode: bool = False,
    embedding_batch_max_jsonl_bytes: int = gemini.DEFAULT_EMBEDDING_BATCH_MAX_JSONL_BYTES,
) -> None:
    if embedding_batch_max_jsonl_bytes <= 0:
        raise ValueError("embedding_batch_max_jsonl_bytes must be positive")

    if db_path is not None:
        chroma.configure(db_path)
    catalog.configure()

    if reset:
        chroma.reset_collection()
        catalog.reset()
        if config.THUMBS_DIR.exists():
            for f in config.THUMBS_DIR.iterdir():
                if f.is_file():
                    f.unlink()
        log.info("reset: cleared database and thumbnails")

    resolved_media_dir = Path(media_dir).resolve() if media_dir else config.MEDIA_DIR
    if not resolved_media_dir.exists():
        log.error("media directory not found: %s", resolved_media_dir)
        return
    files = [f for f in resolved_media_dir.rglob("*") if f.is_file()]
    files.sort()
    log.info("found %d files in %s", len(files), resolved_media_dir)

    pending: list[_PendingItem] = []
    pending_jsonl_bytes = 0
    seen_hashes: set[str] = set()
    indexed_count = 0
    skipped_count = 0
    started_at = time.monotonic()

    for file_index, f in enumerate(files, start=1):
        if file_index == 1 or file_index % 25 == 0 or file_index == len(files):
            log.info(
                "preprocess progress %d/%d: queued=%d queued_jsonl=%s indexed=%d skipped=%d elapsed=%.1fs",
                file_index,
                len(files),
                len(pending),
                format_bytes(pending_jsonl_bytes),
                indexed_count,
                skipped_count,
                time.monotonic() - started_at,
            )
        item = _preprocess_file(f, force=force, seen_hashes=seen_hashes, reverse_geocode=reverse_geocode)
        if item is None:
            skipped_count += 1
            continue

        item_jsonl_bytes = gemini.estimate_embedding_request_jsonl_bytes(
            item.file_id,
            item.processed_data,
            item.processed_mime,
        )
        if item_jsonl_bytes > gemini.MAX_BATCH_INPUT_FILE_BYTES:
            log.error(
                "skipped (embedding request too large, estimated %.1f MiB): %s",
                item_jsonl_bytes / (1024 * 1024),
                item.path,
            )
            skipped_count += 1
            continue

        if pending and pending_jsonl_bytes + item_jsonl_bytes > embedding_batch_max_jsonl_bytes:
            indexed_count += _index_pending_batch(pending)
            pending = []
            pending_jsonl_bytes = 0

        pending.append(item)
        pending_jsonl_bytes += item_jsonl_bytes

        if item_jsonl_bytes > embedding_batch_max_jsonl_bytes:
            log.warning(
                "single item exceeds embedding batch target (estimated %.1f MiB), indexing alone: %s",
                item_jsonl_bytes / (1024 * 1024),
                item.path,
            )
            indexed_count += _index_pending_batch(pending)
            pending = []
            pending_jsonl_bytes = 0

    if not pending:
        if indexed_count == 0:
            log.info("nothing to index")
    else:
        indexed_count += _index_pending_batch(pending)

    if indexed_count:
        log.info(
            "indexing complete: %d items indexed, %d skipped, elapsed=%.1fs",
            indexed_count,
            skipped_count,
            time.monotonic() - started_at,
        )

    if annotate:
        from services.pipeline import annotator
        log.info("starting annotation pass")
        annotator.annotate_unannotated()

    if detect_nsfw:
        from services.pipeline import nsfw
        log.info("starting NSFW detection pass")
        nsfw.detect_undetected()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index media files into SQLite and ChromaDB")
    parser.add_argument("--force", action="store_true", help="Re-index already-indexed files")
    parser.add_argument(
        "--annotate",
        action="store_true",
        help="Annotate unannotated items with descriptions and search terms via Gemini",
    )
    parser.add_argument(
        "--detect-nsfw",
        action="store_true",
        help="Detect NSFW content locally and store results in item metadata",
    )
    parser.add_argument(
        "--db-path",
        default=None,
        help=f"Path to the ChromaDB persistent directory (default: {config.DB_PATH})",
    )
    parser.add_argument(
        "--media-dir",
        default=None,
        help=f"Path to media directory, must be inside DATA_DIR (default: {config.MEDIA_DIR})",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Wipe the database and all thumbnails before indexing",
    )
    parser.add_argument(
        "--reverse-geocode",
        action="store_true",
        help="Call Nominatim for GPS reverse geocoding during metadata extraction (off by default for bulk runs)",
    )
    parser.add_argument(
        "--embedding-batch-max-jsonl-mb",
        type=float,
        default=gemini.DEFAULT_EMBEDDING_BATCH_MAX_JSONL_BYTES / (1024 * 1024),
        help=(
            "Target maximum size for each embedding request JSONL file in MiB "
            f"(default: {gemini.DEFAULT_EMBEDDING_BATCH_MAX_JSONL_BYTES // (1024 * 1024)})"
        ),
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Console log level (default: INFO)",
    )
    args = parser.parse_args()
    _configure_log_level(args.log_level)
    run(
        force=args.force,
        annotate=args.annotate,
        detect_nsfw=args.detect_nsfw,
        db_path=args.db_path,
        media_dir=args.media_dir,
        reset=args.reset,
        reverse_geocode=args.reverse_geocode,
        embedding_batch_max_jsonl_bytes=int(args.embedding_batch_max_jsonl_mb * 1024 * 1024),
    )
