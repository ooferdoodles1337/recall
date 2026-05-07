from pathlib import Path

# --- Paths ---

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "data"
MEDIA_DIR = DATA_DIR / "media"
THUMBS_DIR = DATA_DIR / "thumbnails"
DB_PATH = DATA_DIR / "databases" / "chroma_db"
CATALOG_DB_PATH = DATA_DIR / "databases" / "catalog.sqlite"

# --- Media processing limits ---

MAX_VIDEO_SECONDS = 128.0  # Videos longer than this are truncated before embedding

# --- Upload limits ---

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
ACCEPTED_UPLOAD_MIMES = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
