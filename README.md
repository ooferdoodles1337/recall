# Recall

Personal-media semantic-search app. A pre-indexed media catalog is distributed to participants; they run only the API server.

## Prerequisites

| Dependency | Ubuntu / WSL | macOS |
|------------|-------------|-------|
| **Python 3.14** | `sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt update && sudo apt install python3.14 python3.14-venv` | `brew install python@3.14` |
| **uv** | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | Same |
| **Node.js + npm** | `sudo apt install nodejs npm` | `brew install node` |
| **ExifTool** (maintainers only) | `sudo apt install libimage-exiftool-perl` | `brew install exiftool` |
| **ffmpeg** (maintainers only) | `sudo apt install ffmpeg` | `brew install ffmpeg` |

## Quick start

### 1. Environment variables

Create `.env` at the **repo root** (not inside `backend/`):

```
GEMINI_API_KEY=your_key_here
```

### 2. Backend

```bash
cd backend
uv sync                           # runtime dependencies only
uv sync --group indexing          # add if running the indexer (maintainers only)
uv run uvicorn main:app --reload  # starts at http://localhost:8000
```

API docs are available at `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev  # starts at http://localhost:5173
```

## Data layout

```
backend/
  data/
    media/          # source media files (images and videos)
    thumbnails/     # WebP thumbnails ({uuid}.webp)
    databases/
      chroma_db/       # ChromaDB vector store
      catalog.sqlite   # SQLite media catalog
```

The `backend/data/` directory is pre-built and distributed to demo participants.

## Running tests

```bash
cd backend
uv run pytest -v
```

## Indexing media (maintainers only)

```bash
uv run python -m services.indexer            # index everything
uv run python -m services.indexer --force    # re-index existing files
uv run python -m services.indexer --annotate # generate descriptions
uv run python -m services.indexer --reset    # wipe DB + thumbs, re-index
```

See `backend/README.md` for the full API reference and indexing documentation.
