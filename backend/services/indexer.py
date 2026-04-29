import argparse
import hashlib
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

import config
from services import chroma, gemini, metadata as metadata_svc
from services.media import (
    IMAGE_EXTENSIONS,
    classify_extension,
    generate_thumbnail,
    process_image,
    process_video,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class _PendingItem:
    file_id: str
    rel_path: str
    path: Path
    processed_data: bytes
    processed_mime: str
    processed_media_type: str
    file_metadata: dict


def _preprocess_file(path: Path, force: bool) -> _PendingItem | None:
    """Process a file for indexing without embedding. Returns None if the file should be skipped."""
    ext = path.suffix.lower()

    if classify_extension(ext) is None:
        log.warning("skipped (unsupported): %s", path)
        return None

    try:
        rel_path = str(path.relative_to(config.DATA_DIR))
    except ValueError:
        log.error("file is outside DATA_DIR and cannot be indexed portably: %s", path)
        return None

    content_hash = _file_hash(path)
    existing_id = chroma.get_id_by_hash(content_hash)

    if not force and existing_id is not None:
        log.info("skipped (already indexed): %s", path)
        return None

    file_id = existing_id or str(uuid.uuid4())

    try:
        path_str = str(path)
        processed = process_image(path_str) if ext in IMAGE_EXTENSIONS else process_video(path_str)
        file_metadata = metadata_svc.extract(path_str)
        file_metadata["content_hash"] = content_hash

        thumbnail_bytes = generate_thumbnail(path_str, processed.media_type)
        config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
        thumbnail_abs = config.THUMBS_DIR / f"{file_id}.webp"
        thumbnail_abs.write_bytes(thumbnail_bytes)
        file_metadata["thumbnail_path"] = str(thumbnail_abs.relative_to(config.DATA_DIR))

        return _PendingItem(
            file_id=file_id,
            rel_path=rel_path,
            path=path,
            processed_data=processed.data,
            processed_mime=processed.mime_type,
            processed_media_type=processed.media_type,
            file_metadata=file_metadata,
        )
    except Exception as exc:
        log.error("failed preprocessing (%s): %s", type(exc).__name__, path)
        return None


def index_file(path: Path, force: bool) -> None:
    """Index a single file. Embeds immediately (no batching)."""
    ext = path.suffix.lower()

    if classify_extension(ext) is None:
        log.warning("skipped (unsupported): %s", path)
        return

    try:
        rel_path = str(path.relative_to(config.DATA_DIR))
    except ValueError:
        log.error("file is outside DATA_DIR and cannot be indexed portably: %s", path)
        return

    content_hash = _file_hash(path)
    existing_id = chroma.get_id_by_hash(content_hash)

    if not force and existing_id is not None:
        log.info("skipped (already indexed): %s", path)
        return

    file_id = existing_id or str(uuid.uuid4())

    try:
        path_str = str(path)
        processed = process_image(path_str) if ext in IMAGE_EXTENSIONS else process_video(path_str)
        content_embedding = gemini.embed_content(processed.data, processed.mime_type)
        file_metadata = metadata_svc.extract(path_str)
        file_metadata["content_hash"] = content_hash

        thumbnail_bytes = generate_thumbnail(path_str, processed.media_type)
        config.THUMBS_DIR.mkdir(parents=True, exist_ok=True)
        thumbnail_abs = config.THUMBS_DIR / f"{file_id}.webp"
        thumbnail_abs.write_bytes(thumbnail_bytes)
        file_metadata["thumbnail_path"] = str(thumbnail_abs.relative_to(config.DATA_DIR))

        chroma.upsert_content(
            file_id=file_id,
            embedding=content_embedding,
            path=rel_path,
            filename=path.name,
            mime_type=processed.mime_type,
            media_type=processed.media_type,
            extra_metadata=file_metadata,
        )
        log.info("indexed: %s", path)
    except Exception as exc:
        log.error("failed (%s): %s", type(exc).__name__, path)


def run(
    force: bool,
    annotate: bool = False,
    db_path: str | None = None,
    media_dir: str | None = None,
    reset: bool = False,
) -> None:
    if db_path is not None:
        chroma.configure(db_path)

    if reset:
        chroma.reset_collection()
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
    log.info("found %d files in %s", len(files), resolved_media_dir)

    pending: list[_PendingItem] = []
    for f in files:
        item = _preprocess_file(f, force=force)
        if item is not None:
            pending.append(item)

    if not pending:
        log.info("nothing to index")
    else:
        log.info("batch embedding %d items", len(pending))
        embed_inputs = [(item.file_id, item.processed_data, item.processed_mime) for item in pending]
        embeddings = gemini.embed_content_batch(embed_inputs)

        for item in pending:
            embedding = embeddings.get(item.file_id)
            if embedding is None:
                log.error("no embedding returned for: %s", item.path)
                continue
            try:
                chroma.upsert_content(
                    file_id=item.file_id,
                    embedding=embedding,
                    path=item.rel_path,
                    filename=item.path.name,
                    mime_type=item.processed_mime,
                    media_type=item.processed_media_type,
                    extra_metadata=item.file_metadata,
                )
                log.info("indexed: %s", item.path)
            except Exception as exc:
                log.error("failed upserting (%s): %s", type(exc).__name__, item.path)

    if annotate:
        from services import annotator
        log.info("starting annotation pass")
        annotator.annotate_unannotated()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index media files into ChromaDB")
    parser.add_argument("--force", action="store_true", help="Re-index already-indexed files")
    parser.add_argument(
        "--annotate",
        action="store_true",
        help="Annotate unannotated items with descriptions and search terms via Gemini",
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
    args = parser.parse_args()
    run(force=args.force, annotate=args.annotate, db_path=args.db_path, media_dir=args.media_dir, reset=args.reset)
