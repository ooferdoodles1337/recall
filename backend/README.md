# Backend

FastAPI backend for the Recall user-testing demo. Provides semantic search over a pre-indexed media dataset. End users never run the indexer — they download the pre-built SQLite media catalog and ChromaDB vector store, then run the API server only.

## Setup

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/).

2. Create `.env` at the **repo root** (one level above `backend/`) and fill in your key:
   ```
   GEMINI_API_KEY=your_key_here
   ```

3. Install runtime dependencies (run from `backend/`):
   ```bash
   uv sync
   ```

   Maintainers who run indexing should install the indexing dependency group:
   ```bash
   uv sync --group indexing
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

For a barebones browser-based tester that stays separate from the main frontend, open `http://localhost:8000/tester`. It can hit the existing GET endpoints, show the raw response, and preview thumbnails or original media for returned items.

## Data layout

```
backend/
  data/
    media/          # source media files (images and videos)
    thumbnails/     # WebP thumbnails, one per indexed item ({uuid}.webp)
    databases/
      chroma_db/       # persistent ChromaDB vector store
      catalog.sqlite   # SQLite media catalog
```

The entire `backend/data/` directory is distributed to demo participants as a zip. They extract it at `backend/data/` and run the server — no indexing needed.

## Indexing (maintainer only)

Run this once to build the SQLite catalog and ChromaDB vector store from the media files in `backend/data/media/`:

```bash
uv run python -m services.indexer
```

Options:
- `--force` — re-index files that are already indexed
- `--annotate` — after indexing, run the annotation pass to generate descriptions and internal search phrases for any unannotated items (requires `GEMINI_API_KEY`)
- `--detect-nsfw` — after indexing, run local NSFW detection for items without checked `safety` metadata
- `--db-path <path>` — use a different ChromaDB directory (default: `backend/data/databases/chroma_db`)
- `--media-dir <path>` — scan a different media directory (default: `backend/data/media`)

`--detect-nsfw` uses `Marqo/nsfw-image-detection-384` through TIMM. The model weights are downloaded from Hugging Face on first use and cached locally by the underlying libraries. This pass runs entirely outside the API server path and writes results into `metadata.safety`.

The indexer:
1. Recursively scans `backend/data/media/` for supported files
2. Computes a SHA-256 hash of the raw file bytes
3. Skips files whose hash is already in the SQLite catalog (idempotent without `--force`)
4. Processes images/videos into an embeddable format (transcodes if needed)
5. Embeds content via `gemini-embedding-2`
6. Extracts EXIF/XMP metadata and reverse-geocodes GPS coordinates
7. Generates a 320 px WebP thumbnail (first frame for videos) and writes it to `backend/data/thumbnails/{uuid}.webp`
8. Upserts metadata into SQLite using a UUID primary key and upserts the content embedding into ChromaDB with the same UUID
9. If `--annotate` is passed, submits unannotated items to the Gemini Batch API in packs of 10, polls until complete, and writes `metadata.search.description` and `metadata.search.phrases`
10. If `--detect-nsfw` is passed, runs `Marqo/nsfw-image-detection-384` locally through TIMM for items without checked `metadata.safety` and writes the UI state, score, labels, and model info. Images are analyzed directly; videos are analyzed through their generated thumbnail.

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

### `GET /search/semantic`

Semantic (vector) search over the indexed media collection using a natural-language query.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Natural-language search query |
| `n` | int ≥ 1 | `5` | Number of results to return |

**Response**

```json
{
  "query": "sunset at the beach",
  "results": [
    {
      "id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
      "distance": 0.312,
      "links": {
        "media": "/media/3f4a8b2c-1234-5678-abcd-ef0123456789",
        "thumbnail": "/media/3f4a8b2c-1234-5678-abcd-ef0123456789/thumbnail"
      },
      "metadata": {
        "asset": {
          "filename": "IMG_4821.jpg",
          "mime_type": "image/jpeg",
          "media_type": "image",
          "paths": {
            "original": "media/IMG_4821.jpg",
            "thumbnail": "thumbnails/3f4a8b2c-1234-5678-abcd-ef0123456789.webp"
          }
        },
        "capture": {
          "date": "2024-03-18",
          "year_month": "2024-03",
          "sort_key": "2024-03-18T14:22:09",
          "location": { "city": "Kuta", "country": "Indonesia" }
        },
        "search": {
          "description": "A wide-angle beach scene at golden hour...",
          "phrases": ["sunset beach", "golden hour", "ocean waves"]
        },
        "safety": { "state": "safe", "score": 0.99 },
        "organization": { "favorite": false, "folders": [] },
        "raw": { "exif": {} },
        "system": {
          "schema_version": 2,
          "content_hash": "e3b0c44298fc1c149afb..."
        }
      }
    }
  ]
}
```

`distance` is the cosine distance from the query embedding — lower is more similar. `id` is a UUID. `links.media` and `links.thumbnail` are the frontend-facing URLs. The stored path values under `metadata.asset.paths` are server-local relative paths.

Metadata is grouped by purpose:

- `asset` — filename, MIME/media type, relative storage paths, dimensions, and duration.
- `capture` — normalized date/sort fields plus optional reverse-geocoded location.
- `search` — optional generated description and internal search phrases. These are not user-facing tags.
- `safety` — UI-ready state (`safe`, `sensitive`, `nsfw`, or `unknown`) plus optional model details.
- `organization` — user-level state such as `favorite` and `folders`.
- `raw.exif` — flattened EXIF/tool metadata retained for debugging and future migrations.
- `system` — schema version, content hash, indexing provenance, and embedding model metadata.

---

### `GET /search/suggest`

Returns autocomplete suggestions for a partial query. Backed by an in-memory index of `metadata.search.phrases` from the SQLite catalog — no ChromaDB or Gemini calls. Use on every keystroke.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Partial search query |
| `n` | int ≥ 1 | `5` | Maximum number of suggestions to return |

Suggestions are prefix matches first; fuzzy matches fill any remaining slots.

**Response**

```json
{
  "suggestions": [
    "sunset beach",
    "sunset silhouette",
    "sunset over mountains"
  ]
}
```

---

### `GET /search/text`

Keyword search against the `metadata.search.phrases` index. Tries exact match → prefix union → fuzzy union and returns all matched items.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Search query |
| `n` | int ≥ 1 | `10` | Maximum number of results to return |

**Response**

```json
{
  "query": "golden hour beach",
  "results": [
    {
      "id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
      "distance": null,
      "metadata": { ... },
      "links": { ... }
    }
  ]
}
```

`distance` is `null` for text matches — there is no cosine score, unlike semantic search.

---

### `GET /search/similar/{id}`

Returns items visually similar to an already-indexed item, using its stored embedding — no Gemini API call needed. The query item itself is excluded from results.

**Path params**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | UUID of the indexed item to search from |

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `n` | int ≥ 1 | `5` | Number of results to return |

**Response**

```json
{
  "query_id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
  "results": [
    { "id": "...", "distance": 0.18, "metadata": { ... }, "links": { ... } }
  ]
}
```

Returns 404 if the UUID is not in the vector store.

---

### `POST /search/similar`

Accepts an uploaded image and returns visually similar items from the indexed collection. The uploaded file is embedded on-the-fly and never added to the catalog.

**Request:** `multipart/form-data` with a single `file` field containing the image.

**Accepted types:** `image/jpeg`, `image/png`, `image/webp`, `image/gif`

**Max size:** 20 MB

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `n` | int ≥ 1 | `5` | Number of results to return |

**Response**

```json
{
  "query_filename": "photo.jpg",
  "results": [
    { "id": "...", "distance": 0.22, "metadata": { ... } }
  ]
}
```

Returns 415 for unsupported file types, 413 if the file exceeds 20 MB.

---

### `GET /catalog/items`

Returns the complete metadata catalog for gallery views. Does not serve file bytes — returns IDs, metadata, and links so the frontend can render a chronological gallery, group by `metadata.capture.date`, and lazy-load thumbnails by URL.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `media_type` | `image` or `video` | optional | Restrict results by media type |
| `order` | `asc` or `desc` | `desc` | Sort by `metadata.capture.sort_key` |

**Response**

```json
{
  "count": 1,
  "results": [
    {
      "id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
      "links": {
        "media": "/media/3f4a8b2c-1234-5678-abcd-ef0123456789",
        "thumbnail": "/media/3f4a8b2c-1234-5678-abcd-ef0123456789/thumbnail"
      },
      "metadata": {
        "asset": {
          "filename": "IMG_4821.jpg",
          "media_type": "image",
          "mime_type": "image/jpeg",
          "paths": {
            "original": "media/IMG_4821.jpg",
            "thumbnail": "thumbnails/3f4a8b2c.webp"
          }
        },
        "capture": {
          "taken_at": "2024-03-18T14:22:09",
          "date": "2024-03-18",
          "year_month": "2024-03",
          "sort_key": "2024-03-18T14:22:09"
        }
      }
    }
  ]
}
```

For same-date browsing, use the selected item's `metadata.capture.date` and filter the loaded results client-side.

---

### `GET /catalog/items/{id}`

Returns stored metadata for a single item without serving the file.

**Response**

```json
{
  "id": "3f4a8b2c-1234-5678-abcd-ef0123456789",
  "links": {
    "media": "/media/3f4a8b2c-1234-5678-abcd-ef0123456789",
    "thumbnail": "/media/3f4a8b2c-1234-5678-abcd-ef0123456789/thumbnail"
  },
  "metadata": {
    "asset": {
      "filename": "IMG_4821.jpg",
      "mime_type": "image/jpeg",
      "media_type": "image",
      "paths": {
        "original": "media/IMG_4821.jpg",
        "thumbnail": "thumbnails/3f4a8b2c-1234-5678-abcd-ef0123456789.webp"
      }
    },
    "search": {
      "description": "A wide-angle beach scene at golden hour...",
      "phrases": ["sunset beach", "golden hour", "ocean waves"]
    },
    "system": {
      "schema_version": 2,
      "content_hash": "e3b0c44298fc1c149afb..."
    }
  }
}
```

Returns 404 if the UUID is not in the catalog.

---

### `POST /catalog/items/batch`

Fetch metadata for multiple items in one request. Useful for hydrating search results or pre-loading a set of IDs.

**Request body**

```json
{ "ids": ["uuid-a", "uuid-b", "uuid-c"] }
```

**Response**

```json
{
  "results": [
    { "id": "uuid-a", "metadata": { ... }, "links": { ... } },
    { "id": "uuid-b", "metadata": { ... }, "links": { ... } }
  ],
  "missing": ["uuid-c"]
}
```

IDs not found in the catalog appear in `missing` rather than causing an error.

---

### `GET /catalog/facets`

Returns aggregate counts useful for building filter UI.

**Response**

```json
{
  "media_type": { "image": 280, "video": 32 },
  "taken_year_month": { "2024-01": 14, "2024-02": 38, "2024-03": 61 }
}
```

---

### `GET /catalog/stats`

Returns a high-level summary of the indexed collection.

**Response**

```json
{
  "total": 312,
  "by_media_type": { "image": 280, "video": 32 }
}
```

---

### `GET /media/{id}`

Serves the raw media file for a given UUID. The UUID comes from the `id` field in any search response.

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

### `GET /trials`

Returns a random sample of items from the collection to use as trial targets for a user-testing session. Each call returns a freshly randomised set.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `n` | int ≥ 1 | `5` | Number of targets to return |

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
