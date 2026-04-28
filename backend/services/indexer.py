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


def run(force: bool, db_path: str | None = None) -> None:
    if db_path is not None:
        chroma.configure(db_path)

    media_dir = Path(MEDIA_DIR)
    if not media_dir.exists():
        log.error("media directory not found: %s", MEDIA_DIR)
        return
    files = [f for f in media_dir.rglob("*") if f.is_file()]
    log.info("found %d files in %s", len(files), MEDIA_DIR)
    for f in files:
        index_file(str(f), force=force)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index media files into ChromaDB")
    parser.add_argument("--force", action="store_true", help="Re-index already-indexed files")
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to the ChromaDB persistent directory (default: data/databases)",
    )
    args = parser.parse_args()
    run(force=args.force, db_path=args.db_path)
