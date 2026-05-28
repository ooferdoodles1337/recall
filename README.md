# Recall

Personal-media semantic-search app. A pre-indexed media catalog is distributed to participants; they run only the API server.

## Prerequisites

Install these before running Recall.

| Dependency      | Install instructions                                                             | Notes                                                       |
| --------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **uv**          | [uv installation guide](https://docs.astral.sh/uv/getting-started/installation/) | Required for backend dependency management                  |
| **Python 3.14** | [Installing Python with uv](https://docs.astral.sh/uv/guides/install-python/)    | Install through `uv`                                        |
| **Node.js**     | [Node.js download page](https://nodejs.org/en/download)                          | Required for the frontend. `npm` comes bundled with Node.js |
| **ExifTool**    | [ExifTool installation guide](https://exiftool.org/install.html)                 | Maintainers only                                            |
| **ffmpeg**      | [FFmpeg download page](https://ffmpeg.org/download.html)                         | Maintainers only                                            |

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
uv run python -m services.pipeline.indexer            # index everything
uv run python -m services.pipeline.indexer --force    # re-index existing files
uv run python -m services.pipeline.indexer --annotate # generate descriptions
uv run python -m services.pipeline.indexer --reset    # wipe DB + thumbs, re-index
```

See `backend/README.md` for the full API reference and indexing documentation.
