# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Recall is a personal-media semantic-search app built as a user-testing demo. A pre-indexed ChromaDB is distributed to participants; they run only the API server.

## Project layout

- `backend/` — FastAPI server, indexing tools, and all runtime services.
- `frontend/` — React + TypeScript + Vite demo UI (not empty).

## Commands

All commands run from `backend/`. Python 3.14, managed by `uv`.

```bash
# Run all tests
uv run pytest -v

# Run a single test file
uv run pytest tests/test_metadata.py -v

# Start dev server (http://localhost:8000, /docs for Swagger UI)
uv run uvicorn main:app --reload

# Index media files into ChromaDB (maintainer only)
# Requires indexing dependencies: uv sync --group indexing
uv run python -m services.indexer
uv run python -m services.indexer --force         # re-index existing
uv run python -m services.indexer --annotate      # annotate unannotated items
uv run python -m services.indexer --db-path PATH  # custom DB location

# Run annotator standalone
uv run python -m services.annotator

# CLI search tool (for debugging)
uv run python scripts/query.py "your query here"

# Add a dependency
uv add <package>
```

`.env` lives at the **repo root** (not inside `backend/`). Required key: `GEMINI_API_KEY`.

## Architecture

### Data flow

**Indexing (offline, maintainer only):**
`services/indexer.py` → SHA-256 hash for dedup → `services/media.py` (transcode to JPEG/MP4) → `services/gemini.py` (embed via `gemini-embedding-2`) → `services/metadata.py` (EXIF + reverse geocode) → `services/chroma.py` (upsert with UUID primary key)
Optional: `services/annotator.py` (Gemini batch annotation → `description` + `search_terms` metadata)

**Search (runtime):**
- `GET /search/semantic?q=` → `services/gemini.py` (embed query text) → `services/chroma.py` (top-k vector query) → returns UUIDs + metadata
- `GET /search/text?q=` → `services/text_index.py` (exact/prefix/fuzzy term match) → `services/chroma.py` (fetch items) → returns UUIDs + metadata
- `GET /search/suggest?q=` → `services/text_index.py` (prefix + fuzzy autocomplete) → returns search term suggestions

**Media serving (runtime):**
`GET /media/{uuid}` → `services/chroma.py` (lookup path from metadata) → `FileResponse`
`GET /media/{uuid}/thumbnail` → `services/chroma.py` (lookup `thumbnail_path`) → `FileResponse`
`GET /media/info?id={uuid}` → returns metadata without serving the file

### Key invariants

- **ChromaDB primary key** is a UUID (not the file path). The file path is stored in metadata as `path`.
- **Dedup** is by `content_hash` (SHA-256 of raw file bytes), stored in metadata. `--force` re-indexes by reusing the existing UUID for that hash, so no duplicates are created.
- **ChromaDB metadata values** must be `str | int | float | bool` only. `metadata.py._sanitize_value` enforces this. EXIF keys with colons/spaces/dashes are flattened to underscores (e.g. `EXIF:Make` → `EXIF_Make`).
- **Embedding dimension** is 3072 (gemini-embedding-2). Test fixtures use `[0.1] * 3072`.
- Videos longer than 128 s are truncated before embedding. Animated GIF/PNG are converted to MP4.

### Test isolation

Tests never hit the real ChromaDB or Gemini API. `conftest.py` sets a dummy `GEMINI_API_KEY`. Tests that touch ChromaDB monkeypatch `services.chroma.content_collection` with a `chromadb.EphemeralClient` collection.
