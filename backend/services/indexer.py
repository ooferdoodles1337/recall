import argparse
import logging
from pathlib import Path

from dotenv import load_dotenv

from services import chroma, gemini, metadata as metadata_svc
from services.media import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    classify_extension,
    process_image,
    process_video,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

MEDIA_DIR = "data/media"


def index_file(path: str, force: bool) -> None:
    p = Path(path)
    file_id = str(p)
    ext = p.suffix.lower()

    if classify_extension(ext) is None:
        log.warning("skipped (unsupported): %s", path)
        return

    if not force and chroma.is_indexed(file_id):
        log.info("skipped (already indexed): %s", path)
        return

    try:
        processed = process_image(path) if ext in IMAGE_EXTENSIONS else process_video(path)
        content_embedding = gemini.embed_content(processed.data, processed.mime_type)
        file_metadata = metadata_svc.extract(path)

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
