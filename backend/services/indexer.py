import argparse
import hashlib
import logging
import uuid
from pathlib import Path

from dotenv import load_dotenv

from services import chroma, gemini, metadata as metadata_svc
from services.media import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    classify_extension,
    generate_thumbnail,
    process_image,
    process_video,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

MEDIA_DIR = "data/media"
THUMBNAILS_DIR = "data/thumbnails"



def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def index_file(path: str, force: bool) -> None:
    p = Path(path)
    ext = p.suffix.lower()

    if classify_extension(ext) is None:
        log.warning("skipped (unsupported): %s", path)
        return

    content_hash = _file_hash(path)
    existing_id = chroma.get_id_by_hash(content_hash)

    if not force and existing_id is not None:
        log.info("skipped (already indexed): %s", path)
        return

    file_id = existing_id or str(uuid.uuid4())

    try:
        processed = process_image(path) if ext in IMAGE_EXTENSIONS else process_video(path)
        content_embedding = gemini.embed_content(processed.data, processed.mime_type)
        file_metadata = metadata_svc.extract(path)
        file_metadata["content_hash"] = content_hash

        thumbnail_bytes = generate_thumbnail(path, processed.media_type)
        thumbnails_dir = Path(THUMBNAILS_DIR)
        thumbnails_dir.mkdir(parents=True, exist_ok=True)
        thumbnail_path = str(thumbnails_dir / f"{file_id}.webp")
        Path(thumbnail_path).write_bytes(thumbnail_bytes)
        file_metadata["thumbnail_path"] = thumbnail_path

        chroma.upsert_content(
            file_id=file_id,
            embedding=content_embedding,
            path=path,
            filename=p.name,
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
) -> None:
    if db_path is not None:
        chroma.configure(db_path)

    resolved_media_dir = Path(media_dir) if media_dir else Path(MEDIA_DIR)
    if not resolved_media_dir.exists():
        log.error("media directory not found: %s", resolved_media_dir)
        return
    files = [f for f in resolved_media_dir.rglob("*") if f.is_file()]
    log.info("found %d files in %s", len(files), resolved_media_dir)
    for f in files:
        index_file(str(f), force=force)

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
        help="Path to the ChromaDB persistent directory (default: data/databases)",
    )
    parser.add_argument(
        "--media-dir",
        default=None,
        help="Path to media directory (default: data/media)",
    )
    args = parser.parse_args()
    run(force=args.force, annotate=args.annotate, db_path=args.db_path, media_dir=args.media_dir)
