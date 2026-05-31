# Recall

Personal-media semantic-search app. A pre-indexed media catalog is distributed to participants; they run only the API server.

## Prerequisites

Install the following before running Recall.

| Dependency | Required for | Install instructions |
|------------|--------------|----------------------|
| **uv** | Backend dependency management and Python runtime setup | [uv installation guide](https://docs.astral.sh/uv/getting-started/installation/) |
| **Python 3.14** | Backend runtime | [Python downloads](https://www.python.org/downloads/) or [install Python with uv](https://docs.astral.sh/uv/guides/install-python/) |
| **Node.js** | Frontend development server | [Node.js downloads](https://nodejs.org/en/download)

Maintainers also need the following tools for indexing media.

| Dependency | Required for | Install instructions |
|------------|--------------|----------------------|
| **ExifTool** | Metadata extraction during indexing | [ExifTool installation guide](https://exiftool.org/install.html) |
| **FFmpeg** | Video processing and thumbnail generation during indexing | [FFmpeg download page](https://ffmpeg.org/download.html) |

## Quick start

### 1. Environment variables

Create `.env` at the **repo root** (not inside `backend/`):

```
GEMINI_API_KEY=your_key_here
```

### 2. Start

From the repo root:

```bash
./start.sh
```

The script syncs backend dependencies (`uv sync`) and frontend dependencies (`npm install`) automatically, then starts both servers. No manual install step needed.

Output:

```
Syncing dependencies...

  Frontend: http://localhost:5173
  On LAN:   http://192.168.x.x:5173  (phone / other devices)

Press Ctrl+C to stop.
```

API docs: `http://localhost:8000/docs`

**Starting servers separately** (if you need independent control):

```bash
# Backend — terminal 1
cd backend
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0

# Frontend — terminal 2
cd frontend
pnpm install
pnpm run dev
```

## Accessing from a phone or other device

The frontend proxies all API requests through Vite, so any device on the same network only needs to reach port `5173` — no direct backend access required.

1. Start the servers with `./start.sh` (or with `--host 0.0.0.0` manually, as shown above).
2. Find your machine's local IP — `start.sh` prints it automatically, or run `ip route get 1.1.1.1 | awk '/src/{print $7}'` on Linux / `ipconfig getifaddr en0` on macOS.
3. Open `http://<your-ip>:5173` in the phone's browser.

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
