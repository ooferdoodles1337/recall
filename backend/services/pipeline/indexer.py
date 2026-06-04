import argparse
import hashlib
import logging
import mimetypes
import time
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

import config
from services.catalog import db as catalog
from services.catalog import extractor as metadata_svc
from services.catalog import schema as metadata_schema
from services.providers import gemini
from services.search import chroma
from services.utils import format_bytes
from services.pipeline.media import (
    ANIMATED_IMAGE_EXTS,
    IMAGE_EXTENSIONS,
    classify_extension,
    generate_animated_thumbnail,
    generate_display,
    generate_thumbnail,
    needs_display_rendition,
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
    file_size: int
    file_mtime_ns: int
    processed_data: bytes
    processed_mime: str
    file_metadata: dict


@dataclass(frozen=True)
class _SkipFile:
    reason: str
    media_type: str | None = None
    rel_path: str | None = None
    content_hash: str | None = None


@dataclass(frozen=True)
class _ReuseFile:
    reason: str
    file_id: str
    media_type: str
    rel_path: str
    content_hash: str
    file_size: int
    file_mtime_ns: int
    old_rel_path: str | None = None


@dataclass(frozen=True)
class _IndexFile:
    media_type: str
    rel_path: str
    content_hash: str
    file_size: int
    file_mtime_ns: int
    existing_id: str | None


_FileDecision = _SkipFile | _ReuseFile | _IndexFile


def _original_mime_type(path: Path, media_type: str) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    return "image/jpeg" if media_type == "image" else "video/mp4"


def _relative_media_path(path: Path) -> str | None:
    try:
        # Normalize to NFC: Apple/HFS+ hands over decomposed (NFD) filenames for
        # non-ASCII names (e.g. Korean), but DATA_DIR / rel_path lookups and the
        # filesystem on Linux use composed (NFC) form. Storing NFC keeps every
        # later `is_file()` resolution (serving, refresh, re-index) consistent.
        return unicodedata.normalize("NFC", str(path.relative_to(config.DATA_DIR)))
    except ValueError:
        log.error("file is outside DATA_DIR and cannot be indexed portably: %s", path)
        return None


def _file_stat(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def _classify_file(
    path: Path,
    *,
    force: bool,
    seen_hashes: set[str],
    records_by_path: dict[str, dict],
    records_by_hash: dict[str, dict],
) -> _FileDecision:
    media_type = classify_extension(path.suffix.lower())
    if media_type is None:
        return _SkipFile(reason="unsupported")

    rel_path = _relative_media_path(path)
    if rel_path is None:
        return _SkipFile(reason="outside_data_dir", media_type=media_type)

    file_size, file_mtime_ns = _file_stat(path)
    existing_path_record = records_by_path.get(rel_path)
    if (
        not force
        and existing_path_record is not None
        and existing_path_record.get("file_size") == file_size
        and existing_path_record.get("file_mtime_ns") == file_mtime_ns
    ):
        return _SkipFile(reason="unchanged_stat", media_type=media_type, rel_path=rel_path)

    content_hash = _file_hash(path)
    existing_hash_record = records_by_hash.get(content_hash)
    if content_hash in seen_hashes:
        return _SkipFile(
            reason="duplicate_in_run",
            media_type=media_type,
            rel_path=rel_path,
            content_hash=content_hash,
        )

    if (
        not force
        and existing_path_record is not None
        and existing_path_record.get("content_hash") == content_hash
    ):
        return _ReuseFile(
            reason="same_path_same_hash",
            file_id=existing_path_record["id"],
            media_type=media_type,
            rel_path=rel_path,
            content_hash=content_hash,
            file_size=file_size,
            file_mtime_ns=file_mtime_ns,
        )

    if not force and existing_hash_record is not None and existing_hash_record.get("asset_path") != rel_path:
        old_rel_path = existing_hash_record.get("asset_path")
        old_abs_path = config.DATA_DIR / old_rel_path if isinstance(old_rel_path, str) else None
        if old_abs_path is not None and not old_abs_path.exists():
            return _ReuseFile(
                reason="moved_or_renamed",
                file_id=existing_hash_record["id"],
                media_type=media_type,
                rel_path=rel_path,
                content_hash=content_hash,
                file_size=file_size,
                file_mtime_ns=file_mtime_ns,
                old_rel_path=old_rel_path,
            )
        return _SkipFile(
            reason="duplicate_content",
            media_type=media_type,
            rel_path=rel_path,
            content_hash=content_hash,
        )

    return _IndexFile(
        media_type=media_type,
        rel_path=rel_path,
        content_hash=content_hash,
        file_size=file_size,
        file_mtime_ns=file_mtime_ns,
        existing_id=existing_path_record["id"] if existing_path_record is not None else None,
    )


def _preprocess_file(
    path: Path,
    force: bool,
    seen_hashes: set[str] | None = None,
    *,
    reverse_geocode: bool = True,
    content_hash: str | None = None,
    existing_id: str | None = None,
    file_size: int | None = None,
    file_mtime_ns: int | None = None,
    skip_existing: bool = True,
) -> _PendingItem | None:
    """Process a file for indexing without embedding. Returns None if the file should be skipped."""
    started_at = time.monotonic()
    ext = path.suffix.lower()
    original_media_type = classify_extension(ext)

    if original_media_type is None:
        log.warning("skipped (unsupported): %s", path)
        return None

    rel_path = _relative_media_path(path)
    if rel_path is None:
        return None

    if file_size is None or file_mtime_ns is None:
        file_size, file_mtime_ns = _file_stat(path)
    if content_hash is None:
        content_hash = _file_hash(path)
    log.debug(
        "preprocess start: path=%s media_type=%s raw=%s sha256=%s",
        path,
        original_media_type,
        format_bytes(file_size),
        content_hash[:12],
    )
    if seen_hashes is not None and content_hash in seen_hashes:
        log.info("skipped (duplicate in this run): %s", path)
        return None

    if existing_id is None:
        existing_id = catalog.get_id_by_hash(content_hash)

    if skip_existing and not force and existing_id is not None:
        log.info("skipped (already indexed): %s", path)
        return None

    file_id = existing_id or str(uuid.uuid4())

    try:
        path_str = str(path)
        processed = process_image(path_str) if ext in IMAGE_EXTENSIONS else process_video(path_str)
        file_metadata = metadata_svc.extract(path_str, reverse_geocode=reverse_geocode)
        file_metadata["content_hash"] = content_hash
        file_metadata["file_size"] = file_size
        file_metadata["file_mtime_ns"] = file_mtime_ns

        thumbnail_bytes = generate_thumbnail(path_str, processed.media_type)
        config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
        thumbnail_abs = config.THUMBS_DIR / f"{file_id}.webp"
        thumbnail_abs.write_bytes(thumbnail_bytes)
        file_metadata["thumbnail_path"] = str(thumbnail_abs.relative_to(config.DATA_DIR))

        if needs_display_rendition(path_str):
            display_bytes = generate_display(path_str)
            if display_bytes is not None:
                display_abs = config.THUMBS_DIR / f"{file_id}_display.webp"
                display_abs.write_bytes(display_bytes)
                file_metadata["display_path"] = str(display_abs.relative_to(config.DATA_DIR))
                log.debug("display rendition: %s (%s)", display_abs.name, format_bytes(len(display_bytes)))

        if ext in ANIMATED_IMAGE_EXTS:
            animated_bytes = generate_animated_thumbnail(path_str)
            if animated_bytes is not None:
                anim_abs = config.THUMBS_DIR / f"{file_id}_animated.webp"
                anim_abs.write_bytes(animated_bytes)
                file_metadata["animated_thumbnail_path"] = str(anim_abs.relative_to(config.DATA_DIR))
                log.debug("animated thumbnail: %s (%s)", anim_abs.name, format_bytes(len(animated_bytes)))
            else:
                log.debug("animated thumbnail skipped (too large or not animated): %s", path.name)

        if seen_hashes is not None:
            seen_hashes.add(content_hash)

        elapsed = time.monotonic() - started_at
        log.debug(
            "preprocess complete: path=%s id=%s processed=%s mime=%s thumbnail=%s elapsed=%.1fs",
            path,
            file_id,
            format_bytes(len(processed.data)),
            processed.embedding_mime,
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
            file_size=file_size,
            file_mtime_ns=file_mtime_ns,
            processed_data=processed.data,
            processed_mime=processed.embedding_mime,
            file_metadata=file_metadata,
        )
    except Exception as exc:
        log.error("failed preprocessing (%s): %s", type(exc).__name__, path, exc_info=True)
        return None


def _store_indexed_item(item: _PendingItem, embedding: list[float]) -> None:
    """Write a single preprocessed item and its embedding to ChromaDB and SQLite."""
    chroma.upsert_content(file_id=item.file_id, embedding=embedding)
    catalog.upsert_item(
        file_id=item.file_id,
        path=item.rel_path,
        filename=item.path.name,
        mime_type=item.original_mime,
        media_type=item.original_media_type,
        extra_metadata=item.file_metadata,
        embedding_mime_type=item.processed_mime,
    )


def _store_existing_file_state(
    *,
    file_id: str,
    path: Path,
    rel_path: str,
    media_type: str,
    content_hash: str,
    file_size: int,
    file_mtime_ns: int,
) -> bool:
    """Update catalog path/stat metadata without touching the existing embedding."""
    item = catalog.get_item(file_id)
    if item is None:
        return False
    existing = item["metadata"] or {}
    rebuilt = metadata_schema.rebuild_metadata(
        path=rel_path,
        filename=path.name,
        mime_type=_original_mime_type(path, media_type),
        media_type=media_type,
        existing_metadata=existing,
        content_hash=content_hash,
        thumbnail_path=metadata_schema.thumbnail_path(existing),
        embedding_mime_type=metadata_schema.embedding_mime_type(existing),
    )
    rebuilt = metadata_schema.merge_metadata(
        rebuilt,
        {"system": {"file": {"size": file_size, "mtime_ns": file_mtime_ns}}},
    )
    catalog.replace_metadata(file_id, rebuilt)
    return True


def _embed_pending_inline(pending: list[_PendingItem]) -> dict[str, list[float]]:
    embeddings: dict[str, list[float]] = {}
    for item in pending:
        started_at = time.monotonic()
        log.info("embedding inline: %s", item.path.name)
        embeddings[item.file_id] = gemini.embed_content(item.processed_data, item.processed_mime)
        log.info("inline embedding returned for %s in %.1fs", item.path.name, time.monotonic() - started_at)
    return embeddings


def _index_pending_batch(pending: list[_PendingItem], *, inline_threshold: int = 0) -> list[str]:
    """Embed and store a batch of pending items, returning the ids actually stored."""
    if not pending:
        return []

    estimated_jsonl_bytes = sum(
        gemini.estimate_embedding_request_jsonl_bytes(item.file_id, item.processed_data, item.processed_mime)
        for item in pending
    )
    media_bytes = sum(len(item.processed_data) for item in pending)
    started_at = time.monotonic()
    if inline_threshold > 0 and len(pending) <= inline_threshold:
        log.info(
            "inline embedding %d items: media=%s estimated_jsonl=%s first=%s last=%s",
            len(pending),
            format_bytes(media_bytes),
            format_bytes(estimated_jsonl_bytes),
            pending[0].path.name,
            pending[-1].path.name,
        )
        embeddings = _embed_pending_inline(pending)
    else:
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
        "embedding returned %d/%d vectors in %.1fs",
        len(embeddings),
        len(pending),
        time.monotonic() - started_at,
    )

    stored_ids: list[str] = []
    for item in pending:
        embedding = embeddings.get(item.file_id)
        if embedding is None:
            log.error("no embedding returned for: %s", item.path)
            continue
        try:
            _store_indexed_item(item, embedding)
            stored_ids.append(item.file_id)
            log.info("indexed: %s", item.path)
        except Exception as exc:
            log.error("failed upserting (%s): %s", type(exc).__name__, item.path, exc_info=True)

    return stored_ids


def regenerate_thumbnails(db_path: str | None = None) -> None:
    """Regenerate every thumbnail on disk without touching embeddings or other catalog data."""
    if db_path is not None:
        chroma.configure(db_path)
    catalog.configure()

    records = catalog.get_all_asset_records()
    total = len(records)
    log.info("regenerate-thumbnails: %d items", total)
    ok = failed = skipped = 0

    for i, (item_id, media_type, rel_path, rel_thumb) in enumerate(records, 1):
        if i == 1 or i % 50 == 0 or i == total:
            log.info("progress %d/%d  ok=%d  failed=%d  skipped=%d", i, total, ok, failed, skipped)

        if not rel_path:
            log.warning("no asset_path, skipping: %s", item_id)
            skipped += 1
            continue

        abs_path = config.DATA_DIR / rel_path
        if not abs_path.exists():
            log.warning("source file missing, skipping: %s", abs_path)
            skipped += 1
            continue

        if rel_thumb:
            thumb_abs = config.DATA_DIR / rel_thumb
        else:
            config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
            thumb_abs = config.THUMBS_DIR / f"{item_id}.webp"

        try:
            thumb_bytes = generate_thumbnail(str(abs_path), media_type)
            thumb_abs.parent.mkdir(parents=True, exist_ok=True)
            thumb_abs.write_bytes(thumb_bytes)
            ok += 1
            log.debug("ok: %s", abs_path.name)
        except Exception as exc:
            log.error("failed (%s): %s", type(exc).__name__, abs_path.name)
            failed += 1

    log.info("regenerate-thumbnails complete: ok=%d  failed=%d  skipped=%d", ok, failed, skipped)


def regenerate_animated_thumbnails(db_path: str | None = None) -> None:
    """Generate (or regenerate) animated WebP thumbnails for all qualifying GIF items."""
    from services.pipeline.media import ANIMATED_THUMBNAIL_MAX_SOURCE_BYTES

    if db_path is not None:
        chroma.configure(db_path)
    catalog.configure()

    records = catalog.get_records_for_animated_regen()
    total = len(records)
    log.info("regenerate-animated-thumbnails: %d GIF items", total)
    ok = failed = 0
    skip_missing = skip_static = skip_toolarge = skip_nopath = 0

    for i, (item_id, rel_path, existing_rel_anim) in enumerate(records, 1):
        if i == 1 or i % 50 == 0 or i == total:
            skipped = skip_missing + skip_static + skip_toolarge + skip_nopath
            log.info(
                "progress %d/%d  ok=%d  failed=%d  skipped=%d (static=%d too-large=%d missing=%d no-path=%d)",
                i, total, ok, failed, skipped, skip_static, skip_toolarge, skip_missing, skip_nopath,
            )

        if not rel_path:
            skip_nopath += 1
            continue

        abs_path = config.DATA_DIR / rel_path
        if not abs_path.exists():
            log.warning("source file missing, skipping: %s", abs_path)
            skip_missing += 1
            continue

        try:
            source_size = abs_path.stat().st_size
            if source_size > ANIMATED_THUMBNAIL_MAX_SOURCE_BYTES:
                log.debug("skipped (too large: %s): %s", format_bytes(source_size), abs_path.name)
                skip_toolarge += 1
                continue

            animated_bytes = generate_animated_thumbnail(str(abs_path))
            if animated_bytes is None:
                log.debug("skipped (static or error): %s", abs_path.name)
                skip_static += 1
                continue

            if existing_rel_anim:
                anim_abs = config.DATA_DIR / existing_rel_anim
            else:
                config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
                anim_abs = config.THUMBS_DIR / f"{item_id}_animated.webp"

            anim_abs.parent.mkdir(parents=True, exist_ok=True)
            anim_abs.write_bytes(animated_bytes)
            rel_anim = str(anim_abs.relative_to(config.DATA_DIR))
            if rel_anim != existing_rel_anim:
                catalog.update_animated_thumbnail_path(item_id, rel_anim)
            ok += 1
            log.debug("ok: %s", abs_path.name)
        except Exception as exc:
            log.error("failed (%s): %s", type(exc).__name__, abs_path.name)
            failed += 1

    skipped = skip_missing + skip_static + skip_toolarge + skip_nopath
    log.info(
        "regenerate-animated-thumbnails complete: ok=%d  failed=%d  skipped=%d (static=%d too-large=%d missing=%d no-path=%d)",
        ok, failed, skipped, skip_static, skip_toolarge, skip_missing, skip_nopath,
    )


def regenerate_display(db_path: str | None = None) -> None:
    """Generate (or regenerate) web-friendly display renditions for HEIC-like items."""
    if db_path is not None:
        chroma.configure(db_path)
    catalog.configure()

    records = catalog.get_all_asset_records()
    total = len(records)
    log.info("regenerate-display: scanning %d items", total)
    ok = failed = skipped = 0

    for i, (item_id, _media_type, rel_path, _rel_thumb) in enumerate(records, 1):
        if i == 1 or i % 50 == 0 or i == total:
            log.info("progress %d/%d  ok=%d  failed=%d  skipped=%d", i, total, ok, failed, skipped)

        if not rel_path or not needs_display_rendition(rel_path):
            skipped += 1
            continue

        abs_path = config.DATA_DIR / rel_path
        if not abs_path.exists():
            log.warning("source file missing, skipping: %s", abs_path)
            skipped += 1
            continue

        try:
            display_bytes = generate_display(str(abs_path))
            if display_bytes is None:
                skipped += 1
                continue
            config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
            display_abs = config.THUMBS_DIR / f"{item_id}_display.webp"
            display_abs.write_bytes(display_bytes)
            catalog.update_display_path(item_id, str(display_abs.relative_to(config.DATA_DIR)))
            ok += 1
            log.debug("ok: %s", abs_path.name)
        except Exception as exc:
            log.error("failed (%s): %s", type(exc).__name__, abs_path.name)
            failed += 1

    log.info("regenerate-display complete: ok=%d  failed=%d  skipped=%d", ok, failed, skipped)


def prune_missing(db_path: str | None = None, dry_run: bool = False) -> None:
    """Remove catalog + ChromaDB entries whose source files no longer exist on disk."""
    if db_path is not None:
        chroma.configure(db_path)
    catalog.configure()

    records = catalog.get_all_asset_records()
    total = len(records)
    log.info("prune-missing: scanning %d catalog entries", total)
    pruned = skipped = 0

    for item_id, _media_type, rel_path, rel_thumb in records:
        if not rel_path:
            log.warning("no asset_path for %s — skipping", item_id)
            skipped += 1
            continue

        abs_path = config.DATA_DIR / rel_path
        if abs_path.exists():
            continue

        log.info("%s %s  (%s)", "would remove" if dry_run else "removing", item_id, rel_path)
        if not dry_run:
            try:
                catalog.delete_item(item_id)
            except Exception as exc:
                log.error("catalog delete failed (%s): %s", type(exc).__name__, item_id)
                continue
            try:
                chroma.delete_content(item_id)
            except Exception as exc:
                log.warning("chroma delete failed (%s): %s — catalog entry already removed", type(exc).__name__, item_id)
            if rel_thumb:
                thumb_abs = config.DATA_DIR / rel_thumb
                if thumb_abs.exists():
                    thumb_abs.unlink(missing_ok=True)
        pruned += 1

    action = "would prune" if dry_run else "pruned"
    log.info("prune-missing complete: %s=%d  skipped=%d  scanned=%d", action, pruned, skipped, total)


def index_file(path: Path, force: bool) -> None:
    """Index a single file. Embeds immediately (no batching)."""
    item = _preprocess_file(path, force=force)
    if item is None:
        return

    try:
        content_embedding = gemini.embed_content(item.processed_data, item.processed_mime)
        _store_indexed_item(item, content_embedding)
        log.info("indexed: %s", item.path)
    except Exception as exc:
        log.error("failed (%s): %s", type(exc).__name__, item.path)


def run(
    force: bool,
    annotate: bool = True,
    annotate_sample: int | None = None,
    detect_nsfw: bool = True,
    db_path: str | None = None,
    media_dir: str | None = None,
    reset: bool = False,
    reverse_geocode: bool = False,
    embedding_batch_max_jsonl_bytes: int = gemini.DEFAULT_EMBEDDING_BATCH_MAX_JSONL_BYTES,
    embedding_inline_threshold: int = 4,
    annotation_concurrency: int = 3,
    postprocess_scope: str = "new",
) -> None:
    if embedding_batch_max_jsonl_bytes <= 0:
        raise ValueError("embedding_batch_max_jsonl_bytes must be positive")
    if embedding_inline_threshold < 0:
        raise ValueError("embedding_inline_threshold cannot be negative")
    if annotation_concurrency <= 0:
        raise ValueError("annotation_concurrency must be positive")
    if postprocess_scope not in {"new", "all"}:
        raise ValueError("postprocess_scope must be 'new' or 'all'")

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
    records = catalog.get_index_records()
    records_by_path = {
        row["asset_path"]: row
        for row in records
        if isinstance(row.get("asset_path"), str) and row.get("asset_path")
    }
    records_by_hash = {
        row["content_hash"]: row
        for row in records
        if isinstance(row.get("content_hash"), str) and row.get("content_hash")
    }
    indexed_count = 0
    skipped_count = 0
    stat_skipped_count = 0
    reused_count = 0
    indexed_ids: list[str] = []
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
        decision = _classify_file(
            f,
            force=force,
            seen_hashes=seen_hashes,
            records_by_path=records_by_path,
            records_by_hash=records_by_hash,
        )
        if isinstance(decision, _SkipFile):
            if decision.reason == "unsupported":
                log.warning("skipped (unsupported): %s", f)
            elif decision.reason == "outside_data_dir":
                pass
            elif decision.reason == "unchanged_stat":
                log.info("skipped (unchanged file stat): %s", f)
                stat_skipped_count += 1
            elif decision.reason == "duplicate_in_run":
                log.info("skipped (duplicate in this run): %s", f)
            elif decision.reason == "duplicate_content":
                log.info("skipped (duplicate content already indexed): %s", f)
            else:
                log.warning("skipped (%s): %s", decision.reason, f)
            skipped_count += 1
            continue

        if isinstance(decision, _ReuseFile):
            reused = _store_existing_file_state(
                file_id=decision.file_id,
                path=f,
                rel_path=decision.rel_path,
                media_type=decision.media_type,
                content_hash=decision.content_hash,
                file_size=decision.file_size,
                file_mtime_ns=decision.file_mtime_ns,
            )
            if reused:
                if decision.reason == "moved_or_renamed":
                    log.info("reused embedding (moved/renamed): %s -> %s", decision.old_rel_path, decision.rel_path)
                else:
                    log.info("reused embedding (metadata/stat refresh): %s", f)
                skipped_count += 1
                reused_count += 1
                continue
            if decision.reason == "moved_or_renamed":
                log.info("skipped (duplicate content already indexed): %s", f)
                skipped_count += 1
                continue
            decision = _IndexFile(
                media_type=decision.media_type,
                rel_path=decision.rel_path,
                content_hash=decision.content_hash,
                file_size=decision.file_size,
                file_mtime_ns=decision.file_mtime_ns,
                existing_id=decision.file_id,
            )

        if not isinstance(decision, _IndexFile):
            raise AssertionError(f"unexpected file decision: {decision!r}")

        item = _preprocess_file(
            f,
            force=force,
            seen_hashes=seen_hashes,
            reverse_geocode=reverse_geocode,
            content_hash=decision.content_hash,
            existing_id=decision.existing_id,
            file_size=decision.file_size,
            file_mtime_ns=decision.file_mtime_ns,
            skip_existing=False,
        )
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
            stored = _index_pending_batch(pending, inline_threshold=embedding_inline_threshold)
            indexed_count += len(stored)
            indexed_ids.extend(stored)
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
            stored = _index_pending_batch(pending, inline_threshold=embedding_inline_threshold)
            indexed_count += len(stored)
            indexed_ids.extend(stored)
            pending = []
            pending_jsonl_bytes = 0

    if not pending:
        if indexed_count == 0:
            log.info("nothing to index")
    else:
        stored = _index_pending_batch(pending, inline_threshold=embedding_inline_threshold)
        indexed_count += len(stored)
        indexed_ids.extend(stored)

    if indexed_count:
        log.info(
            "indexing complete: %d items indexed, %d skipped, stat_skipped=%d reused=%d elapsed=%.1fs",
            indexed_count,
            skipped_count,
            stat_skipped_count,
            reused_count,
            time.monotonic() - started_at,
        )

    if annotate or annotate_sample:
        from services.pipeline import annotator
        scoped_ids = indexed_ids if postprocess_scope == "new" else None
        if scoped_ids or postprocess_scope == "all" or annotate_sample:
            scope_label = "newly indexed items" if scoped_ids is not None else "all unannotated items"
            log.info("starting annotation pass for %s", scope_label)
            annotator.annotate_unannotated(
                limit=annotate_sample,
                file_ids=scoped_ids,
                annotation_concurrency=annotation_concurrency,
            )
        else:
            log.info("annotation pass skipped: no newly indexed items")

    if detect_nsfw:
        from services.pipeline import nsfw
        scoped_ids = indexed_ids if postprocess_scope == "new" else None
        if scoped_ids or postprocess_scope == "all":
            scope_label = "newly indexed items" if scoped_ids is not None else "all undetected items"
            log.info("starting NSFW detection pass for %s", scope_label)
            nsfw.detect_undetected(file_ids=scoped_ids)
        else:
            log.info("NSFW detection pass skipped: no newly indexed items")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index media files into SQLite and ChromaDB")
    parser.add_argument("--force", action="store_true", help="Re-index already-indexed files")
    parser.add_argument(
        "--no-annotate",
        dest="annotate",
        action="store_false",
        help="Skip annotating unannotated items with descriptions and search terms via Gemini",
    )
    parser.add_argument(
        "--annotate-sample",
        type=int,
        default=None,
        metavar="N",
        help="Annotate a random sample of N unannotated items instead of all",
    )
    parser.add_argument(
        "--no-detect-nsfw",
        dest="detect_nsfw",
        action="store_false",
        help="Skip NSFW detection",
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
        "--regenerate-thumbnails",
        action="store_true",
        help="Regenerate all thumbnails in-place without touching embeddings or other catalog data, then exit",
    )
    parser.add_argument(
        "--regenerate-animated-thumbnails",
        action="store_true",
        help="Generate/regenerate animated WebP thumbnails for qualifying GIF items, then exit",
    )
    parser.add_argument(
        "--regenerate-display",
        action="store_true",
        help="Generate/regenerate web-friendly display renditions for HEIC-like items, then exit",
    )
    parser.add_argument(
        "--prune-missing",
        action="store_true",
        help="Remove catalog and ChromaDB entries whose source files are missing from disk, then exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --prune-missing: log what would be removed without actually deleting anything",
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
            f"(default: {gemini.DEFAULT_EMBEDDING_BATCH_MAX_JSONL_BYTES / (1024 * 1024):g})"
        ),
    )
    parser.add_argument(
        "--embedding-inline-threshold",
        type=int,
        default=4,
        help=(
            "Use direct embedding calls instead of the Batch API when a pending group has "
            "N items or fewer (default: 4; set 0 to always use Batch API for grouped indexing)"
        ),
    )
    parser.add_argument(
        "--postprocess-scope",
        choices=("new", "all"),
        default="new",
        help="Run annotation/NSFW post-processing on newly indexed items only or all missing items (default: new)",
    )
    parser.add_argument(
        "--annotation-concurrency",
        type=int,
        default=3,
        help="Maximum annotation packs to process concurrently (default: 3; set 1 for serial debugging)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Console log level (default: INFO)",
    )
    parser.set_defaults(annotate=True, detect_nsfw=True)
    args = parser.parse_args()
    _configure_log_level(args.log_level)
    if args.regenerate_thumbnails:
        regenerate_thumbnails(db_path=args.db_path)
        raise SystemExit(0)
    if args.regenerate_animated_thumbnails:
        regenerate_animated_thumbnails(db_path=args.db_path)
        raise SystemExit(0)
    if args.regenerate_display:
        regenerate_display(db_path=args.db_path)
        raise SystemExit(0)
    if args.prune_missing:
        prune_missing(db_path=args.db_path, dry_run=args.dry_run)
        raise SystemExit(0)
    run(
        force=args.force,
        annotate=args.annotate,
        annotate_sample=args.annotate_sample,
        detect_nsfw=args.detect_nsfw,
        db_path=args.db_path,
        media_dir=args.media_dir,
        reset=args.reset,
        reverse_geocode=args.reverse_geocode,
        embedding_batch_max_jsonl_bytes=int(args.embedding_batch_max_jsonl_mb * 1024 * 1024),
        embedding_inline_threshold=args.embedding_inline_threshold,
        annotation_concurrency=args.annotation_concurrency,
        postprocess_scope=args.postprocess_scope,
    )
