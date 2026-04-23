# Multimodal Indexer Design

## Overview

A one-shot script that walks `data/media/`, generates multimodal embeddings via `gemini-embedding-2`, and stores them in ChromaDB. Supports images, animated GIFs/APNGs, and videos. Enables similarity search on file content via a single ChromaDB collection.

---

## Architecture

Five files are touched, all existing stubs:

| File | Role |
|---|---|
| `pyproject.toml` | Swap `google-generativeai` → `google-genai>=1.73.0`; add `Pillow`, `imageio[ffmpeg]` |
| `services/gemini.py` | New SDK client; `embed_content()` and `embed_text()` wrappers |
| `services/chroma.py` | Single collection: `media_content` |
| `services/indexer.py` | Main script: walk `data/media/`, process, embed, upsert |
| `routes/images.py` | Delete — superseded |

Run with: `python -m services.indexer [--force] [--db-path PATH]`

No system dependencies. `imageio[ffmpeg]` bundles the ffmpeg binary.

---

## File Processing Pipeline

### Supported image formats → JPEG or PNG bytes for embedding

| Input | Action |
|---|---|
| `.jpg`, `.jpeg`, `.jfif`, `.pjpeg`, `.pjp` | Read bytes directly (JPEG) |
| `.png` | Read bytes directly (PNG) |
| `.webp` | Pillow → JPEG bytes |
| `.gif` — static (1 frame) | Pillow → JPEG bytes |
| `.gif` — animated (N frames) | imageio → MP4 bytes → embed as video |
| `.apng` — static (1 frame) | Pillow → PNG bytes |
| `.apng` — animated (N frames) | imageio → MP4 bytes → embed as video |
| `.svg` | Skip with log warning |
| Everything else | Skip with log warning |

### Supported video formats → MP4 bytes for embedding

| Input | Action |
|---|---|
| `.mp4`, `.m4v`, `.mov` | Read directly (or truncate if > 128s) |
| `.avi`, `.mkv`, `.wmv`, `.flv`, `.webm`, `.3gp` | Convert to MP4 via imageio, truncate if > 128s |

**Truncation rule:** Videos longer than 128 seconds are truncated to exactly 128 seconds before embedding. This is the hard limit of `gemini-embedding-2`.

---

## ChromaDB Schema

One collection using pre-computed embeddings (vectors passed directly, no ChromaDB embedding function).

### `media_content`
- **id**: normalized relative path (e.g. `data/media/foo.mp4`)
- **embedding**: 3072-dim float vector from `gemini-embedding-2` multimodal
- **metadata**: `{path, filename, mime_type, media_type}`

Default vector size: **3072 dimensions**. Can be reduced to 768 or 1536 later via `output_dimensionality` if storage/latency becomes a concern.

---

## Gemini Service (`services/gemini.py`)

Migrates from `google-generativeai` (old SDK) to `google-genai>=1.73.0` (new SDK).

```python
embed_content(file_bytes: bytes, mime_type: str) -> list[float]
# Embeds raw file bytes as a Part using gemini-embedding-2

embed_text(text: str) -> list[float]
# Embeds a plain text string using gemini-embedding-2
```

Both return `list[float]` of length 3072. On API failure, raises — indexer logs and skips the file.

---

## Indexer Script (`services/indexer.py`)

### CLI

```
python -m services.indexer           # skip already-indexed files
python -m services.indexer --force   # upsert all files regardless
```

### Per-file flow

1. Detect file type by extension
2. Process file: convert/truncate as needed → final bytes + mime_type
3. Call `embed_content()` → upsert to `media_content`
4. Log: `indexed`, `skipped`, or `failed` per file

### Skip logic (default, no `--force`)

Check if `id` already exists in the collection. Skip the file if found.

---

## Dependencies

```toml
dependencies = [
    "chromadb>=1.5.8",
    "fastapi>=0.136.0",
    "google-genai>=1.73.0",
    "imageio[ffmpeg]",
    "Pillow",
    "python-dotenv>=1.2.2",
    "uvicorn>=0.46.0",
]
```

`google-generativeai` is removed entirely.

---

## Out of Scope

- Audio file indexing (`.mp3`, `.wav`) — supported by `gemini-embedding-2` but not requested; easy to add later
- AVIF image format — skipped, requires additional native library
- SVG — skipped, vector format with no pixel content to embed
- File system watcher / hot reloading — one-shot script only for now
- Search API routes — separate feature, not part of this spec
- Metadata extraction / separate metadata collection — deferred for later
