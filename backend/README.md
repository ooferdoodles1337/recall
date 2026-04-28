# Backend

FastAPI backend for the Recall user-testing demo. Provides semantic search over a pre-indexed media dataset. End users never run the indexer — they download the pre-built ChromaDB and run the API server only.

## Setup

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/).

2. Create `.env` at the **repo root** (one level above `backend/`) and fill in your key:
   ```
   GEMINI_API_KEY=your_key_here
   ```

3. Install dependencies (run from `backend/`):
   ```bash
   uv sync
   ```

> **Maintainers only:** indexing also requires ExifTool for metadata extraction.
> ```bash
> # Ubuntu/Debian
> sudo apt install libimage-exiftool-perl
> # macOS
> brew install exiftool
> # Windows: https://exiftool.org
> ```

## Running the server

```bash
uv run uvicorn main:app --reload
```

The server starts at `http://localhost:8000`. Interactive API docs are at `/docs`.

## Data layout

```
backend/
  data/
    media/          # source media files (images and videos)
    thumbnails/     # WebP thumbnails, one per indexed item ({uuid}.webp)
    databases/
      chroma_db/    # persistent ChromaDB vector store
```

The `data/databases/chroma_db/` and `data/thumbnails/` directories are distributed together to demo participants (as a zip). They place both at their respective paths and run the server — no indexing needed.

## Indexing (maintainer only)

Run this once to build the ChromaDB from the media files in `data/media/`:

```bash
uv run python -m services.indexer
```

Options:
- `--force` — re-index files that are already indexed
- `--db-path <path>` — use a different ChromaDB directory (default: `data/databases/chroma_db`)

The indexer:
1. Recursively scans `data/media/` for supported files
2. Computes a SHA-256 hash of the raw file bytes
3. Skips files whose hash is already in the DB (idempotent without `--force`)
4. Processes images/videos into an embeddable format (transcodes if needed)
5. Embeds content via `gemini-embedding-2`
6. Extracts EXIF/XMP metadata and reverse-geocodes GPS coordinates
7. Generates a 320 px WebP thumbnail (first frame for videos) and writes it to `data/thumbnails/{uuid}.webp`
8. Upserts into ChromaDB using a UUID primary key; `content_hash` and `thumbnail_path` are stored in metadata

On `--force`, the existing UUID for that hash is reused so the record is updated in place rather than duplicated.

**Supported formats**

| Type | Extensions |
|------|-----------|
| Image | `.jpg` `.jpeg` `.png` `.apng` `.webp` `.gif` `.jfif` |
| Video | `.mp4` `.m4v` `.mov` `.avi` `.mkv` `.wmv` `.flv` `.webm` `.3gp` |

Animated PNGs/GIFs and videos longer than 128 seconds are transcoded to MP4 before embedding.

## API reference

### `GET /health`

Returns `{"status": "ok"}`. Use to verify the server is up.

---

### `GET /search`

Semantic search over the indexed media collection.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Natural-language search query |
| `n` | int 1–50 | `5` | Number of results to return |

**Response**

```json
{
  "query": "sunset at the beach",
  "results": [
    {
      "id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
      "distance": 0.312,
      "metadata": {
        "filename": "IMG_4821.jpg",
        "mime_type": "image/jpeg",
        "media_type": "image",
        "path": "/data/media/IMG_4821.jpg",
        "content_hash": "e3b0c44298fc1c149afb...",
        "thumbnail_path": "/data/thumbnails/3f4a8b2c-1234-5678-abcd-ef0123456789.webp",
        "geo_city": "Kuta",
        "geo_country": "Indonesia"
      }
    }
  ]
}
```

`distance` is the cosine distance from the query embedding — lower is more similar. `id` is a UUID and is what you pass to `/media/{id}` to fetch the file. `metadata` always includes `filename`, `mime_type`, `media_type`, `path`, `content_hash` (SHA-256 of the original file), and `thumbnail_path` (server-local path to the WebP thumbnail), plus any extracted EXIF fields and reverse-geocoded `geo_*` fields.

---

### `GET /media/{id}`

Serves the raw media file for a given UUID. The UUID comes from the `id` field in `/search` results.

```
GET /media/3f4a8b2c-1234-5678-abcd-ef0123456789
→ image/jpeg bytes
```

---

### `GET /media/{id}/thumbnail`

Serves the pre-generated WebP thumbnail for a given UUID. The thumbnail is a 320 px (longest-edge) WebP image. For video items, the thumbnail is the first frame.

```
GET /media/3f4a8b2c-1234-5678-abcd-ef0123456789/thumbnail
→ image/webp bytes
```

Returns 404 if the item does not exist or has no thumbnail (items indexed before this feature was added will lack one).

---

### `GET /media/info`

Returns the stored metadata for a single item without serving the file.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Item UUID (same as the `id` field from `/search`) |

**Response**

```json
{
  "id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
  "metadata": {
    "filename": "IMG_4821.jpg",
    "mime_type": "image/jpeg",
    "media_type": "image",
    "path": "/data/media/IMG_4821.jpg",
    "content_hash": "e3b0c44298fc1c149afb...",
    "thumbnail_path": "/data/thumbnails/3f4a8b2c-1234-5678-abcd-ef0123456789.webp",
    "geo_city": "Kuta",
    "geo_country": "Indonesia"
  }
}
```

---

### `GET /trials`

Returns a random sample of items from the collection to use as trial targets for a user-testing session. Each call returns a freshly randomised set.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `n` | int 1–50 | `5` | Number of targets to return |

**Response**

```json
{
  "n": 5,
  "targets": [
    {
      "id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
      "metadata": { ... }
    }
  ]
}
```

**Usage in the demo**: call this once at the start of a session to get the ordered list of targets. Show the user the image for target[0], let them search, record the time, then advance to target[1], and so on.

---

### `GET /collection/stats`

Returns a summary of the indexed collection.

**Response**

```json
{
  "total": 312,
  "by_media_type": {
    "image": 280,
    "video": 32
  }
}
```
