# AGENTS.md / CLAUDE.md

This file provides guidance to coding agents when working with this repository. `AGENTS.md` is a root-level symlink to this file; do not create nested `AGENTS.md` files in `backend/` or `frontend/`.

## Project overview

Recall is a personal-media semantic-search app built as a user-testing demo. A pre-indexed SQLite media catalog and ChromaDB vector store are distributed to participants; they run only the API server.

## Project layout

- `backend/` — FastAPI server, indexing tools, and all runtime services.
- `frontend/` — React/Vite browser app for the fullscreen desktop user-testing harness and standalone phone tester route.

## Commands

Backend commands run from `backend/`. Python 3.14, managed by `uv`.

```bash
# Run all tests
uv run pytest -v

# Run a single test file
uv run pytest tests/test_metadata.py -v

# Start dev server (http://localhost:8000, /docs for Swagger UI)
uv run uvicorn main:app --reload

# Index media files into SQLite + ChromaDB (maintainer only)
# Requires indexing dependencies: uv sync --group indexing
uv run python -m services.pipeline.indexer
uv run python -m services.pipeline.indexer --force         # re-index existing files
uv run python -m services.pipeline.indexer --annotate      # annotate unannotated items after indexing
uv run python -m services.pipeline.indexer --db-path PATH  # custom DB location
uv run python -m services.pipeline.indexer --reset         # wipe DB and thumbnails, then index

# CLI search tool (for debugging)
uv run python scripts/query.py "your query here"

# Add a dependency
uv add <package>
```

Frontend commands run from `frontend/`. React 19 and Vite are managed by npm.

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Production build / typecheck
npm run build

# Preview built app
npm run preview
```

`.env` lives at the **repo root** (not inside `backend/`). Required keys:

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | yes | Embedding and Gemini batch annotation |

Frontend API configuration:

| Variable | Required | Description |
|---|---|---|
| `VITE_RECALL_API_BASE_URL` | no | API base URL for the frontend (default: `http://localhost:8000`) |

## Frontend product constraints

- The guided user-testing program is a desktop fullscreen application, not a mobile-responsive website.
- The app intentionally gates small windows: below 1280 x 720 px, it should show the fullscreen-size warning instead of trying to squeeze the task UI.
- The primary route is `/` (or any non-`/phone` path), which renders `UserTestingWebUI`.
- `/phone` renders the standalone phone tester shell. The phone UI is still a placeholder and should stay visually framed as the participant viewport until implemented.
- The current visual direction is a quiet photo-archive / usability-lab console. Keep typography and styling consistent with `frontend/src/styles/global.css`.
- Fonts are self-hosted with Fontsource packages, imported in `frontend/src/main.tsx`. Do not reintroduce external Google Fonts CSS imports.
- Radix primitives may be used for accessible unstyled UI behavior. Keep custom visual styling in CSS rather than adopting a large styled UI kit.
- Playwright artifacts belong in `.playwright-mcp/`. Do not leave screenshots or generated inspection files in the repo root.

## Architecture

### Data flow

**Indexing (offline, maintainer only):**
`services/pipeline/indexer.py` preprocesses all files first (SHA-256 dedup using `services/catalog/db.py`, `services/pipeline/media.py` transcode, `services/catalog/extractor.py` EXIF + geocode, thumbnail generation), then submits all embeddings to `services/providers/gemini.py` in one Gemini Batch API call (`gemini-embedding-2`), then upserts metadata to SQLite via `services/catalog/db.py` and vectors to `services/search/chroma.py` with the same UUID primary key.

Optional annotation pass (`--annotate`): `services/pipeline/annotator.py` finds unannotated items and submits all packs via `services/providers/gemini_annotation.py` `annotate_packs_batch()` — one Gemini Batch API job, model `gemini-3.1-flash-lite`.

**Search (runtime):**
- `GET /search/semantic?q=` → `services/providers/gemini.py` (embed query text) → `services/search/chroma.py` (top-k vector query) → `services/catalog/db.py` (hydrate metadata) → returns UUIDs + metadata
- `GET /search/text?q=` → `services/search/text_index.py` (exact/prefix/fuzzy term match over SQLite metadata) → `services/catalog/db.py` (fetch items) → returns UUIDs + metadata
- `GET /search/suggest?q=` → `services/search/text_index.py` (prefix + fuzzy autocomplete) → returns search term suggestions
- `GET /search/similar/{id}` → `services/search/chroma.py` (fetch stored embedding by UUID, no Gemini call) → `services/search/chroma.py` (top-k+1 vector query, self excluded) → `services/catalog/db.py` (hydrate) → returns UUIDs + metadata
- `POST /search/similar` (image upload) → `services/pipeline/media.py` (process image) → `services/providers/gemini.py` (embed) → `services/search/chroma.py` (top-k vector query) → `services/catalog/db.py` (hydrate) → returns UUIDs + metadata; file is ephemeral, never indexed

**Catalog browsing (runtime):**
`GET /catalog/items` → `services/catalog/db.py` (all metadata sorted by `taken_sort`) → returns IDs + metadata for chronological API consumers
`GET /catalog/items/{uuid}` → `services/catalog/db.py` (single item metadata lookup) → returns metadata without serving the file
`POST /catalog/items/batch` → `services/catalog/db.py` (bulk metadata fetch by ID list) → returns found items + missing IDs
`GET /catalog/facets` → `services/catalog/db.py` (aggregate counts by `media_type` + `taken_year_month`)
`GET /catalog/stats` → `services/catalog/db.py` (total count + by-type breakdown)

**Media serving (runtime):**
`GET /media/{uuid}` → `services/catalog/db.py` (lookup path from metadata) → `FileResponse`
`GET /media/{uuid}/thumbnail` → `services/catalog/db.py` (lookup `thumbnail_path`) → `FileResponse`

### Key invariants

- **Catalog primary key** is a UUID (not the file path). The file path is stored in metadata as `path`. ChromaDB uses the same UUID for the vector row.
- **Dedup** is by `content_hash` (SHA-256 of raw file bytes), stored in SQLite metadata. `--force` re-indexes by reusing the existing UUID for that hash, so no duplicates are created.
- **ChromaDB metadata values** must be `str | int | float | bool` only. `services/catalog/extractor.py._sanitize_value` enforces this. EXIF keys with colons/spaces/dashes are flattened to underscores (e.g. `EXIF:Make` → `EXIF_Make`).
- **Chronological fields** are normalized at index time: `taken_at`, `taken_date`, `taken_year_month`, `taken_sort`, and `taken_source`. API consumers can load all metadata with `/catalog/items`, group by `taken_date`, and fetch thumbnails by UUID.
- **Embedding dimension** is 3072 (gemini-embedding-2). Test fixtures use `[0.1] * 3072`.
- Videos longer than 128 s are truncated before embedding. Animated GIF/PNG are converted to MP4.
- **`services/providers/gemini.py`** handles embedding only (`_client`, default API): `embed_text`, `embed_content`, `embed_content_batch`.
- **`services/providers/gemini_annotation.py`** handles annotation batch jobs (`_annotation_client`, v1alpha API). Uses a separate client because annotation requires `http_options={"api_version": "v1alpha"}`.
- **`services/utils.py`** provides shared utilities: `format_bytes` and `inline_schema` (resolves `$ref`/`$defs` for providers that require flat schemas).

### Test isolation

Tests never hit the real Gemini API. `conftest.py` sets a dummy `GEMINI_API_KEY`. Tests that touch ChromaDB monkeypatch `services.search.chroma.content_collection` with a `chromadb.EphemeralClient` collection. Tests that touch SQLite call `services.catalog.db.configure()` with a temporary `catalog.sqlite`.
