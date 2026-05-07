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
uv run python -m services.indexer
uv run python -m services.indexer --force         # re-index existing files
uv run python -m services.indexer --annotate      # annotate unannotated items after indexing
uv run python -m services.indexer --db-path PATH  # custom DB location
uv run python -m services.indexer --reset         # wipe DB and thumbnails, then index

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
| `OPENROUTER_API_KEY` | no | Use OpenRouter for annotation instead of Gemini |
| `OPENROUTER_MODEL` | no | OpenRouter model (default: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`) |

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
`services/indexer.py` preprocesses all files first (SHA-256 dedup using `services/catalog.py`, `services/media.py` transcode, `services/metadata.py` EXIF + geocode, thumbnail generation), then submits all embeddings to `services/gemini.py` in one Gemini Batch API call (`gemini-embedding-2`), then upserts metadata to SQLite via `services/catalog.py` and vectors to `services/chroma.py` with the same UUID primary key.

Optional annotation pass (`--annotate`): `services/annotator.py` finds unannotated items and calls one of two backends:
- **Gemini** (default): `services/gemini.py` `annotate_packs_batch()` — submits all packs in one Gemini Batch API job, model `gemini-3.1-flash-lite-preview`
- **OpenRouter** (set `OPENROUTER_API_KEY`): `services/openrouter.py` `annotate_packs()` — synchronous, one request per pack; images max 8 per pack, videos 1 per pack

**Search (runtime):**
- `GET /search/semantic?q=` → `services/gemini.py` (embed query text) → `services/chroma.py` (top-k vector query) → `services/catalog.py` (hydrate metadata) → returns UUIDs + metadata
- `GET /search/text?q=` → `services/text_index.py` (exact/prefix/fuzzy term match over SQLite metadata) → `services/catalog.py` (fetch items) → returns UUIDs + metadata
- `GET /search/suggest?q=` → `services/text_index.py` (prefix + fuzzy autocomplete) → returns search term suggestions
- `GET /search/similar/{id}` → `services/chroma.py` (fetch stored embedding by UUID, no Gemini call) → `services/chroma.py` (top-k+1 vector query, self excluded) → `services/catalog.py` (hydrate) → returns UUIDs + metadata
- `POST /search/similar` (image upload) → `services/media.py` (process image) → `services/gemini.py` (embed) → `services/chroma.py` (top-k vector query) → `services/catalog.py` (hydrate) → returns UUIDs + metadata; file is ephemeral, never indexed

**Catalog browsing (runtime):**
`GET /catalog/items` → `services/catalog.py` (all metadata sorted by `taken_sort`) → returns IDs + metadata for chronological API consumers
`GET /catalog/items/{uuid}` → `services/catalog.py` (single item metadata lookup) → returns metadata without serving the file
`POST /catalog/items/batch` → `services/catalog.py` (bulk metadata fetch by ID list) → returns found items + missing IDs
`GET /catalog/facets` → `services/catalog.py` (aggregate counts by `media_type` + `taken_year_month`)
`GET /catalog/stats` → `services/catalog.py` (total count + by-type breakdown)

**Media serving (runtime):**
`GET /media/{uuid}` → `services/catalog.py` (lookup path from metadata) → `FileResponse`
`GET /media/{uuid}/thumbnail` → `services/catalog.py` (lookup `thumbnail_path`) → `FileResponse`

### Key invariants

- **Catalog primary key** is a UUID (not the file path). The file path is stored in metadata as `path`. ChromaDB uses the same UUID for the vector row.
- **Dedup** is by `content_hash` (SHA-256 of raw file bytes), stored in SQLite metadata. `--force` re-indexes by reusing the existing UUID for that hash, so no duplicates are created.
- **ChromaDB metadata values** must be `str | int | float | bool` only. `metadata.py._sanitize_value` enforces this. EXIF keys with colons/spaces/dashes are flattened to underscores (e.g. `EXIF:Make` → `EXIF_Make`).
- **Chronological fields** are normalized at index time: `taken_at`, `taken_date`, `taken_year_month`, `taken_sort`, and `taken_source`. API consumers can load all metadata with `/catalog/items`, group by `taken_date`, and fetch thumbnails by UUID.
- **Embedding dimension** is 3072 (gemini-embedding-2). Test fixtures use `[0.1] * 3072`.
- Videos longer than 128 s are truncated before embedding. Animated GIF/PNG are converted to MP4.
- **`services/gemini.py`** has two sections: embedding (`_client`, default API) and annotation batch (`_annotation_client`, v1alpha API). They use separate client instances because annotation requires `http_options={"api_version": "v1alpha"}`.
- **`services/openrouter.py`** is a thin provider used only when `OPENROUTER_API_KEY` is set. It is considered experimental/backburner — free-tier models can return empty responses unpredictably.

### Test isolation

Tests never hit the real Gemini API. `conftest.py` sets a dummy `GEMINI_API_KEY`. Tests that touch ChromaDB monkeypatch `services.chroma.content_collection` with a `chromadb.EphemeralClient` collection. Tests that touch SQLite call `services.catalog.configure()` with a temporary `catalog.sqlite`.
