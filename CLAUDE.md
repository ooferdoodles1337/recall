# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is a root-level symlink to this file; do not create nested `AGENTS.md` files in `backend/` or `frontend/`.

## Project overview

Recall is a personal-media semantic-search app built as a user-testing demo. A pre-indexed SQLite media catalog and ChromaDB vector store are distributed to participants; they run only the API server.

## Commands

### Start both servers (recommended)

```bash
./start.sh
```

Syncs backend and frontend dependencies, then starts both servers. Backend on `:8000`, frontend on `:5173` (LAN-accessible). Press Ctrl+C to stop.

### Backend (run from `backend/`)

Python 3.14, managed by `uv`.

```bash
uv sync                                  # install runtime deps
uv sync --group indexing                 # also install indexing deps (maintainers only)
uv run uvicorn main:app --reload         # start dev server (localhost only)
uv run uvicorn main:app --reload --host 0.0.0.0  # LAN-accessible

uv run pytest -v                         # run all tests
uv run pytest tests/test_metadata.py -v # run a single test file

# Catalog refresh — schema/metadata changes without re-embedding
uv run python -m services.catalog.refresh
uv run python -m services.catalog.refresh --dry-run
uv run python -m services.catalog.refresh --reverse-geocode
uv run python -m services.catalog.refresh --regenerate-thumbnails

# Indexing (maintainers only — requires ExifTool, FFmpeg, uv sync --group indexing)
uv run python -m services.pipeline.indexer
uv run python -m services.pipeline.indexer --force     # re-index existing files
uv run python -m services.pipeline.indexer --annotate  # generate AI descriptions
uv run python -m services.pipeline.indexer --reset     # wipe DB + thumbs, re-index
```

### Frontend (run from `frontend/`)

React 19, Vite 7, TypeScript.

```bash
pnpm install
pnpm run dev          # start Vite dev server (localhost + LAN)
pnpm run build        # typecheck + production build
pnpm run test:unit    # run Vitest unit tests (single pass)
pnpm run test:unit:watch  # watch mode
pnpm exec vitest run tests/unit/phoneReducer.test.ts  # single test file
pnpm run test         # build + unit tests
```

### Environment

`.env` lives at the **repo root** (not inside `backend/`):

```
GEMINI_API_KEY=your_key_here
```

`VITE_RECALL_API_BASE_URL` overrides the API origin for the frontend (default: `""` — relative URLs proxied through Vite to `localhost:8000`).

## Architecture

### Two routes, two UIs

- `/` → `UserTestingWebUI` — fullscreen desktop harness. Requires ≥ 1280×720 px; shows a warning below that. Screen state machine: `welcome → task → results`.
- `/phone` → `PhoneTesterUI` / `PhoneViewportFrame` — iOS-style photo search UI. The primary development surface.

The Vite dev server proxies `/search`, `/catalog`, `/media`, `/health`, `/trials` to `localhost:8000`, so LAN devices only need to reach port `5173`.

### Backend data flow

**Startup:** `chroma.configure()` → `catalog.configure()` → `text_index.build()` (loads all search terms into memory).

**Search paths:**
- `GET /search/semantic?q=` — embeds query via `gemini-embedding-2` (3072-dim), top-k vector query in ChromaDB, hydrates from SQLite.
- `GET /search/text?q=` — in-memory exact/prefix/fuzzy match via `text_index.py` (built from SQLite at startup with rapidfuzz).
- `GET /search/suggest?q=` — same in-memory index, autocomplete only.
- `GET /search/similar/{id}` — fetches stored embedding by UUID (no Gemini call), vector query in ChromaDB.
- `POST /search/similar` — upload image → embed → vector query; file is ephemeral, never indexed.

**Catalog primary key** is a UUID shared by both SQLite and ChromaDB. The file path is stored in metadata, not used as a key.

**ChromaDB constraint:** all metadata values must be `str | int | float | bool`. `extractor._sanitize_value` enforces this; EXIF keys with colons/spaces/dashes are normalized to underscores (e.g. `EXIF:Make` → `EXIF_Make`).

**Videos longer than 128 s** are truncated before embedding. Animated GIF/PNG are transcoded to MP4.

**Two Gemini clients** (kept separate due to API version incompatibility):
- `services/providers/gemini.py` — embedding only (`embed_text`, `embed_content`, `embed_content_batch`), uses default API.
- `services/providers/gemini_annotation.py` — annotation batch jobs, requires `http_options={"api_version": "v1alpha"}`.

### SQLite schema notes

`services/catalog/db.py` maintains a set of promoted columns (e.g. `taken_sort`, `geo_city`, `favorite`, `safety_state`) alongside a `metadata_json` blob. `taken_sort` is the chronological sort key used throughout. `services/catalog/refresh.py` migrates the schema without touching embeddings or UUIDs.

### Phone UI state machine

`phoneReducer.ts` owns the screen state. Screens: `home → compose → results → detail` (depth order). `PhoneModeState` tracks `screen`, `bgContent` (what's rendered under an overlay), `composeStartQuery` (restored on compose dismiss), and a `transition` record (from/to/direction/reason/key).

Actions: `SEARCH_FOCUS`, `SEARCH_COMMIT`, `AUTOSEARCH_COMMIT`, `SEARCH_CLEAR`, `COMPOSE_DISMISS`, `SIMILAR_SEARCH`, `DETAIL_OPEN`, `DETAIL_CLOSE`, `TARGET_RESET`.

**Before modifying `PhoneViewportFrame.tsx`, `phoneReducer.ts`, `SearchCommandLayer.tsx`, or any CSS under `.phone-rect`, read `docs/ux-spec.md`.** It is the authoritative behavioral spec for scroll, compose panel, search bar, and animation rules.

### Frontend styling

- Tailwind v4 + shadcn/ui primitives. All custom CSS is in `frontend/src/styles/global.css`.
- Fonts are self-hosted via Fontsource packages (imported in `main.tsx`). Do not add external Google Fonts CSS imports.
- Radix primitives are used for accessible behavior; visual styling stays in CSS.
- The `@` alias resolves to `frontend/src/`.

### Test isolation

- Backend: `conftest.py` sets a dummy `GEMINI_API_KEY`. SQLite tests call `services.catalog.db.configure()` with a temp path. ChromaDB tests monkeypatch `services.search.chroma.content_collection` with an ephemeral in-memory collection. No real Gemini calls.
- Frontend: Vitest + jsdom + Testing Library. Unit tests cover `phoneReducer`, `PhoneViewportFrame`, and `SearchCommandLayer`.
