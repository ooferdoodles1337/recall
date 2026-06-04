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

The React frontend runs separately from `frontend/` on `http://localhost:5173`.
`main.py` allows CORS from localhost, `127.0.0.1`, and any LAN IP in the
`192.168.x.x`, `10.x.x.x`, and `172.16–31.x.x` ranges — so mobile devices on
the same network can reach the API directly.

## Testing

```bash
uv run pytest -v
```

Tests use a dummy `GEMINI_API_KEY` from `tests/conftest.py`. SQLite tests point
`services.catalog.db` at a temporary catalog, and ChromaDB tests monkeypatch the
content collection with an ephemeral in-memory collection. The test suite should
not call the real Gemini API.

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
uv run python -m services.pipeline.indexer
```

To rebuild only the SQLite metadata shape after changing `services/catalog/schema.py`, without calling Gemini or touching ChromaDB:

```bash
uv run python -m services.catalog.refresh
uv run python -m services.catalog.refresh --dry-run
uv run python -m services.catalog.refresh --reverse-geocode        # fill place names from stored GPS metadata
uv run python -m services.catalog.refresh --extract                  # also re-run local ExifTool extraction
uv run python -m services.catalog.refresh --regenerate-thumbnails    # also regenerate local WebP thumbnails
uv run python -m services.catalog.refresh --regenerate-display       # also regenerate web-friendly display renditions (HEIC)
```

`services.catalog.refresh` preserves item UUIDs, Chroma vector IDs, existing annotation text/search phrases, safety metadata, favorites/folders, and embedding metadata. It is intended for local schema/catalog migrations, not for changed media bytes; if the actual media file content changed, re-run the indexer so the embedding matches the file.

Options:
- `--force` — re-index files that are already indexed
- `--annotate` — after indexing, run the annotation pass to generate descriptions and internal search phrases for any unannotated items (requires `GEMINI_API_KEY`)
- `--annotate-sample <N>` — annotate a random sample of N unannotated items (implies `--annotate`)
- `--detect-nsfw` — after indexing, run local NSFW detection for items without checked `safety` metadata
- `--regenerate-thumbnails` — regenerate all thumbnails in-place without touching embeddings or other catalog data, then exit
- `--regenerate-animated-thumbnails` — generate/regenerate animated WebP thumbnails for qualifying GIF items, then exit
- `--regenerate-display` — generate/regenerate web-friendly full-size display renditions for HEIC-like items, then exit
- `--prune-missing` — remove catalog and ChromaDB entries whose source files are missing from disk, then exit
- `--dry-run` — with `--prune-missing`: log what would be removed without actually deleting anything
- `--db-path <path>` — use a different ChromaDB directory (default: `backend/data/databases/chroma_db`)
- `--media-dir <path>` — scan a different media directory (default: `backend/data/media`)
- `--reset` — wipe the ChromaDB store, SQLite catalog, and thumbnails before indexing
- `--reverse-geocode` — resolve GPS coordinates to place names and promote them into catalog columns. `services.catalog.refresh --reverse-geocode` uses stored GPS metadata and does not regenerate media, thumbnails, embeddings, or annotations.
- `--embedding-batch-max-jsonl-mb <number>` — target maximum size for each Gemini embedding request JSONL file (default: `512` MiB). The indexer automatically creates multiple batch request files when needed.

`--detect-nsfw` uses `Marqo/nsfw-image-detection-384` through TIMM. The model weights are downloaded from Hugging Face on first use and cached locally by the underlying libraries. This pass runs entirely outside the API server path and writes results into `metadata.safety`.

After a full maintainer build, verify that `backend/data/` is portable before zipping or creating a tarball:

```bash
uv run python scripts/verify_data_bundle.py --require-annotations --require-safety
tar -czf recall-data.tar.gz data
```

The verifier checks that the SQLite catalog and ChromaDB collection contain the same UUIDs, that media and thumbnail paths are relative to `backend/data/`, and that all referenced files exist.

The indexer:
1. Recursively scans `backend/data/media/` for supported files
2. Computes a SHA-256 hash of the raw file bytes
3. Skips files whose hash is already in the SQLite catalog (idempotent without `--force`)
4. Processes images/videos into an embeddable format (transcodes if needed)
5. Embeds content via `gemini-embedding-2`, automatically splitting large runs into multiple JSONL input files for Gemini Batch API
6. Extracts EXIF/XMP metadata and, if `--reverse-geocode` is passed, reverse-geocodes GPS coordinates
7. Generates a 320 px WebP thumbnail (first frame for videos) and writes it to `backend/data/thumbnails/{uuid}.webp`. For HEIC/HEIF (which browsers can't display natively), also generates a full-size (≤ 2048 px) WebP **display rendition** at `backend/data/thumbnails/{uuid}_display.webp`, served via `GET /media/{id}/display` and used by the detail view
8. Upserts metadata into SQLite using a UUID primary key and upserts the content embedding into ChromaDB with the same UUID
9. If `--annotate` is passed, annotates unannotated items with synchronous Gemini `generate_content` calls in packs of up to 100 images or 5 videos.
   Media in each pack is uploaded to the Gemini Files API concurrently, then referenced by file URI in the prompt.
   The pass writes `metadata.search.description` and `metadata.search.phrases` after each pack so interrupted runs can resume from remaining unannotated items
10. If `--detect-nsfw` is passed, runs `Marqo/nsfw-image-detection-384` locally through TIMM for items without checked `metadata.safety` and writes the UI state, score, labels, and model info. Images are analyzed directly; videos are analyzed through their generated thumbnail.

On `--force`, the existing UUID for that hash is reused so the record is updated in place rather than duplicated.

**Supported formats**

| Type | Extensions |
|------|-----------|
| Image | `.jpg` `.jpeg` `.png` `.apng` `.webp` `.gif` `.jfif` `.heic` `.heif` |
| Video | `.mp4` `.m4v` `.mov` `.avi` `.mkv` `.wmv` `.flv` `.webm` `.3gp` |

Animated PNGs/GIFs and videos longer than 128 seconds are transcoded to MP4 before embedding. Transcoding uses the FFmpeg executable bundled by the existing `imageio[ffmpeg]` indexing dependency.

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
        "organization": { "favorite": false, "folders": [] }
      }
    }
  ]
}
```

`distance` is the cosine distance from the query embedding — lower is more similar. `id` is a UUID. `links.media` and `links.thumbnail` are API URLs for retrieving media bytes. The stored path values under `metadata.asset.paths` are server-local relative paths.

Metadata is grouped by purpose:

- `asset` — filename, MIME/media type, relative storage paths, dimensions, and duration.
- `capture` — normalized date/sort fields plus optional reverse-geocoded location.
- `search` — optional generated description and internal search phrases. These are not user-facing tags.
- `safety` — UI-ready state (`safe`, `sensitive`, `nsfw`, or `unknown`) plus optional model details.
- `organization` — user-level state such as `favorite` and `folders`.
Search, list, and batch endpoints return compact summary metadata from promoted SQLite columns and omit bulky `raw.exif` and `system` provenance. Use `GET /catalog/items/{id}` when a client needs the full stored metadata document.

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

Returns the compact metadata catalog from promoted SQLite columns. Does not serve file bytes — returns IDs, summary metadata, and links so API consumers can group by `metadata.capture.date` and fetch thumbnails by URL when needed. Bulky `raw.exif` and `system` fields are intentionally omitted here.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `media_type` | `image` or `video` | optional | Restrict results by media type |
| `favorite` | boolean | optional | Filter to favorited (`true`) or non-favorited (`false`) items |
| `order` | `asc` or `desc` | `desc` | Sort by `metadata.capture.sort_key` |
| `limit` | int 1–500 | optional | Maximum number of results to return |

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

Returns the full stored metadata document for a single item without serving the file. This endpoint includes `raw.exif` and `system` provenance.

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

### `PATCH /catalog/items/{id}`

Updates mutable metadata fields for a single item. Only the fields provided in the request body are changed; omitted fields are left untouched. Rebuilds the in-memory text index after a successful write.

**Request body** (all fields optional)

```json
{
  "organization": { "favorite": true },
  "safety":       { "state": "safe" },
  "search":       { "phrases": ["sunset beach", "golden hour"] }
}
```

| Field | Type | Allowed values |
|-------|------|---------------|
| `organization.favorite` | boolean | `true` / `false` |
| `safety.state` | string | `"safe"`, `"nsfw"`, `"unknown"` |
| `search.phrases` | string[] | replacement phrase list used by the text index |

**Response:** the updated full item document (same shape as `GET /catalog/items/{id}`).

Returns 404 if the UUID is not in the catalog; 400 for invalid field values.

---

### `POST /catalog/items/batch`

Fetch metadata for multiple items in one request. Useful for hydrating search results or pre-loading a set of IDs.

This returns the same compact summary shape as `GET /catalog/items`; fetch `GET /catalog/items/{id}` for full raw metadata.

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

Returns a random sample of items from the collection to use as trial targets for a user-testing session. Each call returns a freshly randomized set.

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
