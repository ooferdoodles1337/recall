from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "data"
MEDIA_DIR = DATA_DIR / "media"
THUMBS_DIR = DATA_DIR / "thumbnails"
DB_PATH = DATA_DIR / "databases" / "chroma_db"
