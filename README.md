# Recall

Personal-media semantic-search app. A pre-indexed media catalog is distributed to participants; they run only the API server.

## Prerequisites

| Dependency | Ubuntu / WSL | macOS |
|------------|-------------|-------|
| **uv** | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | Same |
| **Python 3.14** | `uv python install 3.14` | Same |
| **Node.js + npm** | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh \| bash`<br>`\. "$HOME/.nvm/nvm.sh"`<br>`nvm install 24`<br>`node -v  # should print v24.15.0`<br>`npm -v   # should print 11.12.1` | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh \| bash`<br>`\. "$HOME/.nvm/nvm.sh"`<br>`nvm install 24`<br>`node -v  # should print v24.15.0`<br>`npm -v   # should print 11.12.1` |
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
