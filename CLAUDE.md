# AGENTS.md / CLAUDE.md

This file provides guidance to coding agents when working with this repository. `AGENTS.md` is a root-level symlink to this file; do not create nested `AGENTS.md` files in `backend/` or `frontend/`.

## Project overview

Recall is a personal-media semantic-search app built as a user-testing demo. A pre-indexed SQLite media catalog and ChromaDB vector store are distributed to participants; they run only the API server.

## Project layout

- `backend/` — FastAPI server, indexing tools, and all runtime services.
- `frontend/` — React/Vite browser app for the fullscreen desktop user-testing harness and standalone phone tester route.

## Commands

### Starting both servers together (recommended)

From the repo root:

```bash
./start.sh
```

Syncs backend dependencies (`uv sync`) and frontend dependencies (`npm install`), then starts the backend on `:8000` and frontend on `:5173`, both bound to `0.0.0.0`. Prints a LAN URL (`http://<your-ip>:5173`) that phones and other local-network devices can open directly. Press Ctrl+C to stop both.

### LAN / phone access

`vite.config.ts` proxies all backend paths (`/search`, `/catalog`, `/media`, `/health`, `/trials`) from the Vite server to `localhost:8000`. Devices on the LAN only need to reach the Vite server — they never talk directly to the backend. No extra config is required as long as the machine running the servers is on the same network.

`VITE_RECALL_API_BASE_URL` can still override the API origin (e.g. to point at a remote backend), but is not needed for normal LAN use.

### Backend (run from `backend/`)

Python 3.14, managed by `uv`.

```bash
# Run all tests
uv run pytest -v

# Run a single test file
uv run pytest tests/test_metadata.py -v

# Start dev server — localhost only
uv run uvicorn main:app --reload

# Start dev server — accessible on LAN
uv run uvicorn main:app --reload --host 0.0.0.0

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

### Frontend (run from `frontend/`)

React 19 and Vite are managed by npm.

```bash
# Install dependencies
npm install

# Start dev server — localhost only
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
| `VITE_RECALL_API_BASE_URL` | no | Override API origin (default: `""` — relative URLs, proxied through Vite to `localhost:8000`) |

## Frontend product constraints

- The guided user-testing program is a desktop fullscreen application, not a mobile-responsive website.
- The app intentionally gates small windows: below 1280 x 720 px, it should show the fullscreen-size warning instead of trying to squeeze the task UI.
- The primary route is `/` (or any non-`/phone` path), which renders `UserTestingWebUI`.
- `/phone` renders the standalone phone tester shell. The phone UI is still a placeholder and should stay visually framed as the participant viewport until implemented.
- The current visual direction is a quiet photo-archive / usability-lab console. Keep typography and styling consistent with `frontend/src/styles/global.css`.
- Fonts are self-hosted with Fontsource packages, imported in `frontend/src/main.tsx`. Do not reintroduce external Google Fonts CSS imports.
- Radix primitives may be used for accessible unstyled UI behavior. Keep custom visual styling in CSS rather than adopting a large styled UI kit.
- Playwright artifacts belong in `.playwright-mcp/`. Do not leave screenshots or generated inspection files in the repo root.

## File map

A quick index of where things live so you can open the right file immediately.

### Root

| Path | What it is |
|---|---|
| `start.sh` | One-command launcher for both servers (LAN-accessible) |
| `.env` | `GEMINI_API_KEY` and other secrets — repo root, not inside `backend/` |
| `CLAUDE.md` | This file. `AGENTS.md` is a symlink to it. |

### Backend

| Path | What it is |
|---|---|
| `backend/main.py` | FastAPI app, CORS config, router registration, lifespan hook |
| `backend/config.py` | All path constants (`MEDIA_DIR`, `CATALOG_DB_PATH`, etc.) and upload limits |
| `backend/routes/search.py` | `/search/semantic`, `/search/text`, `/search/suggest`, `/search/similar/{id}`, `POST /search/similar` |
| `backend/routes/catalog.py` | `/catalog/items`, `/catalog/items/{uuid}`, `/catalog/items/batch`, `/catalog/facets`, `/catalog/stats` |
| `backend/routes/media.py` | `/media/{uuid}`, `/media/{uuid}/thumbnail` |
| `backend/services/catalog/db.py` | All SQLite reads/writes — the single source of truth for item metadata |
| `backend/services/catalog/schema.py` | Pydantic models for catalog items and metadata |
| `backend/services/catalog/extractor.py` | EXIF extraction, geocoding, `_sanitize_value` for ChromaDB-safe metadata |
| `backend/services/catalog/refresh.py` | Incremental catalog refresh logic |
| `backend/services/search/chroma.py` | ChromaDB client wrapper — vector upsert, top-k query, embedding fetch by ID |
| `backend/services/search/text_index.py` | In-memory exact/prefix/fuzzy text index built from SQLite at startup |
| `backend/services/pipeline/indexer.py` | Offline indexing CLI — dedup, transcode, embed, upsert |
| `backend/services/pipeline/annotator.py` | Offline annotation pass — finds unannotated items, submits Gemini batch job |
| `backend/services/pipeline/media.py` | Media transcoding, thumbnail generation, video truncation |
| `backend/services/pipeline/nsfw.py` | NSFW classification helper used during indexing |
| `backend/services/providers/gemini.py` | Embedding only (`embed_text`, `embed_content`, `embed_content_batch`) |
| `backend/services/providers/gemini_annotation.py` | Annotation batch jobs (v1alpha API, separate client) |
| `backend/services/utils.py` | `format_bytes`, `inline_schema` (flattens `$ref`/`$defs` for providers) |
| `backend/tests/conftest.py` | Shared fixtures: dummy API key, ephemeral ChromaDB, temp SQLite |
| `backend/data/` | Runtime data: `media/`, `thumbnails/`, `databases/` (SQLite + ChromaDB) |

### Frontend

| Path | What it is |
|---|---|
| `frontend/vite.config.ts` | Vite config — host binding, ports, proxy rules for all backend paths |
| `frontend/src/main.tsx` | Entry point — font imports, router, app mount |
| `frontend/src/app/App.tsx` | Root component — route split (`/phone` vs everything else), size gate |
| `frontend/src/shared/api/client.ts` | `recallFetch` wrapper, `recallApiBaseUrl` (default `""` → proxied) |
| `frontend/src/shared/types/recall.ts` | Core TypeScript types: `RecallMediaItem`, `RecallSearchResult`, metadata shapes |
| `frontend/src/shared/media/mediaItem.ts` | Helpers: `isVideo`, `resolvedMediaUrl`, `resolvedThumbnailUrl` |
| `frontend/src/styles/global.css` | All custom CSS — layout tokens, component classes, phone frame, animations |
| `frontend/src/components/ui/` | Shared shadcn-style primitives (Alert, Badge, Button, Card, Input, etc.) |
| `frontend/src/features/phone/` | Standalone phone tester route (`/phone`) |
| `frontend/src/features/phone/PhoneTesterUI.tsx` | Route shell for the phone tester |
| `frontend/src/features/phone/components/PhoneViewportFrame.tsx` | The full phone search UI (search bar, results grid, detail view, selection tray) |
| `frontend/src/features/phone/api/searchApi.ts` | Phone feature's API calls (search, suggest, similar, recent) |
| `frontend/src/features/user-testing/` | Desktop user-testing harness (primary `/` route) |
| `frontend/src/features/user-testing/UserTestingWebUI.tsx` | Harness root — screen state machine (welcome → instructions → task → results) |
| `frontend/src/features/user-testing/screens/` | `WelcomeScreen`, `InstructionsScreen`, `TaskScreen`, `ResultsScreen` |
| `frontend/src/features/user-testing/components/TargetPhotoPanel.tsx` | Target photo display in the task screen |
| `frontend/src/features/user-testing/api/trialsApi.ts` | Fetches trial targets from `/trials` |
| `frontend/src/features/user-testing/api/resultsSink.ts` | Submits session results |
| `frontend/src/features/user-testing/metrics/` | Session timing and event metrics (`sessionMetrics.ts`, `types.ts`) |
| `frontend/src/features/user-testing/tasks/targets.ts` | Static target definitions |
| `frontend/src/lib/utils.ts` | `cn()` class-name helper (clsx + tailwind-merge) |

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
