# Multimodal Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a one-shot CLI script that walks `data/media/`, generates multimodal embeddings via `gemini-embedding-2`, and stores them in a single ChromaDB collection enabling similarity search on file content.

**Architecture:** `services/media.py` handles all file type detection, format conversion (WebP/GIF/APNG→JPEG or MP4, non-native video→MP4, truncation to 128s). `services/gemini.py` wraps the new `google-genai` SDK with embedding functions. `services/chroma.py` exposes one collection (`media_content`) with an upsert helper. `services/indexer.py` orchestrates the pipeline as a CLI with a `--force` flag.

**Tech Stack:** Python 3.14, `google-genai>=1.73.0`, `chromadb>=1.5.8`, `Pillow`, `imageio[ffmpeg]` (bundled ffmpeg binary), `pytest`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `pyproject.toml` | Swap SDK, add Pillow + imageio[ffmpeg], add pytest |
| Delete | `routes/images.py` | Superseded |
| Create | `services/__init__.py` | Package marker |
| Rewrite | `services/gemini.py` | New SDK client; `embed_content()`, `embed_text()` |
| Rewrite | `services/chroma.py` | `media_content` collection; upsert helper; `is_indexed()` |
| Create | `services/media.py` | Type detection, format conversion |
| Rewrite | `services/indexer.py` | CLI orchestration; `index_file()`; `run()` |
| Create | `tests/__init__.py` | Package marker |
| Create | `tests/conftest.py` | Shared env setup |
| Create | `tests/test_gemini.py` | Unit tests for embed functions |
| Create | `tests/test_chroma.py` | Unit tests for collection |
| Create | `tests/test_media.py` | Unit tests for processing |
| Create | `tests/test_indexer.py` | Unit tests for orchestration |

---

## Task 1: Project Setup

**Files:**
- Modify: `pyproject.toml`
- Delete: `routes/images.py`
- Create: `services/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [x] **Step 1: Update pyproject.toml**

Replace the dependencies list entirely:

```toml
[project]
name = "backend"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.14"
dependencies = [
    "chromadb>=1.5.8",
    "fastapi>=0.136.0",
    "google-genai>=1.73.0",
    "imageio[ffmpeg]",
    "Pillow",
    "pytest",
    "python-dotenv>=1.2.2",
    "uvicorn>=0.46.0",
]
```

- [x] **Step 2: Sync dependencies**

```bash
uv sync
```
Expected: all packages install without errors, no version conflicts

- [x] **Step 3: Delete routes/images.py**

```bash
rm routes/images.py
```

- [x] **Step 4: Create package markers and conftest**

`services/__init__.py` — empty file.

`tests/__init__.py` — empty file.

`tests/conftest.py`:
```python
import os
os.environ.setdefault("GEMINI_API_KEY", "test-key")
```

- [x] **Step 5: Verify test runner works**

```bash
pytest tests/ -v
```
Expected: "no tests ran", exit code 0

- [x] **Step 6: Commit**

```bash
git add pyproject.toml services/__init__.py tests/__init__.py tests/conftest.py
git commit -m "feat: project setup for multimodal indexer"
```

---

## Task 2: Gemini Embedding Service

**Files:**
- Rewrite: `services/gemini.py`
- Create: `tests/test_gemini.py`

- [x] **Step 1: Write failing tests**

`tests/test_gemini.py`:
```python
from unittest.mock import MagicMock, patch


def _make_mock_result(n: int = 3072):
    mock_result = MagicMock()
    mock_result.embeddings = [MagicMock()]
    mock_result.embeddings[0].values = [0.1] * n
    return mock_result


def test_embed_text_returns_list_of_floats():
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_text
        result = embed_text("hello world")
    assert isinstance(result, list)
    assert len(result) == 3072
    assert all(isinstance(v, float) for v in result)


def test_embed_text_calls_correct_model():
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_text, _MODEL
        embed_text("hello")
    call_kwargs = mock_client.models.embed_content.call_args[1]
    assert call_kwargs["model"] == _MODEL


def test_embed_content_returns_list_of_floats():
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_content
        result = embed_content(b"\xff\xd8\xff", "image/jpeg")
    assert isinstance(result, list)
    assert len(result) == 3072
    assert all(isinstance(v, float) for v in result)


def test_embed_content_passes_bytes_as_part():
    from google.genai import types
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_content
        embed_content(b"test-bytes", "image/jpeg")
    call_kwargs = mock_client.models.embed_content.call_args[1]
    contents = call_kwargs["contents"]
    assert len(contents) == 1
    assert isinstance(contents[0], types.Part)
```

- [x] **Step 2: Run to verify failure**

```bash
pytest tests/test_gemini.py -v
```
Expected: `ImportError` or `ModuleNotFoundError` — `services.gemini` not yet implemented

- [x] **Step 3: Implement services/gemini.py**

```python
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

_MODEL = "gemini-embedding-2"
_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def embed_text(text: str) -> list[float]:
    result = _client.models.embed_content(model=_MODEL, contents=[text])
    return list(result.embeddings[0].values)


def embed_content(file_bytes: bytes, mime_type: str) -> list[float]:
    part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    result = _client.models.embed_content(model=_MODEL, contents=[part])
    return list(result.embeddings[0].values)
```

- [x] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_gemini.py -v
```
Expected: 4 passed

- [x] **Step 5: Commit**

```bash
git add services/gemini.py tests/test_gemini.py
git commit -m "feat: gemini embedding service with google-genai SDK"
```

---

## Task 3: ChromaDB Collection

**Files:**
- Rewrite: `services/chroma.py`
- Create: `tests/test_chroma.py`

- [x] **Step 1: Write failing tests**

`tests/test_chroma.py`:
```python
import chromadb
import pytest


@pytest.fixture(autouse=True)
def in_memory_chroma(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)


def test_upsert_content_stores_embedding_and_metadata():
    from services.chroma import upsert_content, content_collection
    upsert_content(
        file_id="data/media/foo.jpg",
        embedding=[0.1] * 3072,
        path="data/media/foo.jpg",
        filename="foo.jpg",
        mime_type="image/jpeg",
        media_type="image",
    )
    result = content_collection.get(ids=["data/media/foo.jpg"])
    assert result["ids"] == ["data/media/foo.jpg"]
    assert result["metadatas"][0]["filename"] == "foo.jpg"
    assert result["metadatas"][0]["media_type"] == "image"


def test_is_indexed_true_when_in_content():
    from services.chroma import upsert_content, is_indexed
    file_id = "data/media/foo.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "foo.jpg", "image/jpeg", "image")
    assert is_indexed(file_id) is True


def test_is_indexed_false_when_missing():
    from services.chroma import is_indexed
    assert is_indexed("data/media/missing.jpg") is False
```

- [x] **Step 2: Run to verify failure**

```bash
pytest tests/test_chroma.py -v
```
Expected: `ImportError` — `upsert_content`, `is_indexed` not yet defined

- [x] **Step 3: Implement services/chroma.py**

```python
import chromadb

_client = chromadb.PersistentClient(path="data/chroma_db")
content_collection = _client.get_or_create_collection("media_content")


def upsert_content(
    file_id: str,
    embedding: list[float],
    path: str,
    filename: str,
    mime_type: str,
    media_type: str,
) -> None:
    content_collection.upsert(
        ids=[file_id],
        embeddings=[embedding],
        metadatas=[{"path": path, "filename": filename, "mime_type": mime_type, "media_type": media_type}],
    )


def is_indexed(file_id: str) -> bool:
    return len(content_collection.get(ids=[file_id])["ids"]) > 0
```

- [x] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_chroma.py -v
```
Expected: 3 passed

- [x] **Step 5: Commit**

```bash
git add services/chroma.py tests/test_chroma.py
git commit -m "feat: chromadb single-collection schema with upsert and is_indexed"
```

---

## Task 4: Media Processing — Image Classification and Static Conversion

**Files:**
- Create: `services/media.py`
- Create: `tests/test_media.py`

- [x] **Step 1: Write failing tests**

`tests/test_media.py`:
```python
import io
import os
import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image


# --- Test fixtures ---

def make_jpeg_bytes(width=10, height=10) -> bytes:
    img = Image.new("RGB", (width, height), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def make_png_bytes(width=10, height=10) -> bytes:
    img = Image.new("RGBA", (width, height), color=(0, 255, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def make_webp_bytes(width=10, height=10) -> bytes:
    img = Image.new("RGB", (width, height), color=(0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="WEBP")
    return buf.getvalue()


def make_static_gif_bytes(width=10, height=10) -> bytes:
    img = Image.new("RGB", (width, height), color=(255, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="GIF")
    return buf.getvalue()


def make_animated_gif_bytes(width=10, height=10, n_frames=3) -> bytes:
    frames = [Image.new("P", (width, height)) for _ in range(n_frames)]
    buf = io.BytesIO()
    frames[0].save(
        buf, format="GIF", save_all=True, append_images=frames[1:], loop=0, duration=100
    )
    return buf.getvalue()


def make_static_apng_bytes(width=10, height=10) -> bytes:
    img = Image.new("RGBA", (width, height), color=(255, 0, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def make_animated_apng_bytes(width=10, height=10, n_frames=3) -> bytes:
    frames = [Image.new("RGBA", (width, height), color=(i * 50, 0, 0, 255)) for i in range(n_frames)]
    buf = io.BytesIO()
    frames[0].save(buf, format="PNG", save_all=True, append_images=frames[1:])
    return buf.getvalue()


def make_mp4_bytes(duration_seconds: float = 1.0, fps: int = 10) -> bytes:
    import imageio.v3 as iio
    n_frames = max(1, int(duration_seconds * fps))
    frames = [np.zeros((10, 10, 3), dtype=np.uint8) for _ in range(n_frames)]
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    iio.imwrite(tmp.name, frames, fps=fps, codec="libx264", pixelformat="yuv420p")
    data = Path(tmp.name).read_bytes()
    os.unlink(tmp.name)
    return data


# --- Extension classification ---

def test_classify_jpeg_extensions():
    from services.media import classify_extension
    for ext in [".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp"]:
        assert classify_extension(ext) == "image", f"Expected image for {ext}"


def test_classify_png():
    from services.media import classify_extension
    assert classify_extension(".png") == "image"
    assert classify_extension(".apng") == "image"


def test_classify_webp_and_gif():
    from services.media import classify_extension
    assert classify_extension(".webp") == "image"
    assert classify_extension(".gif") == "image"


def test_classify_video_extensions():
    from services.media import classify_extension
    for ext in [".mp4", ".m4v", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".3gp"]:
        assert classify_extension(ext) == "video", f"Expected video for {ext}"


def test_classify_unknown_returns_none():
    from services.media import classify_extension
    assert classify_extension(".svg") is None
    assert classify_extension(".txt") is None
    assert classify_extension(".pdf") is None


# --- Animated detection ---

def test_is_animated_false_for_static_gif(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_static_gif_bytes())
    from services.media import is_animated
    assert is_animated(str(p)) is False


def test_is_animated_true_for_animated_gif(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_animated_gif_bytes())
    from services.media import is_animated
    assert is_animated(str(p)) is True


def test_is_animated_false_for_static_apng(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_static_apng_bytes())
    from services.media import is_animated
    assert is_animated(str(p)) is False


def test_is_animated_true_for_animated_apng(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_animated_apng_bytes())
    from services.media import is_animated
    assert is_animated(str(p)) is True


# --- Static image processing ---

def test_process_jpeg_returns_original_bytes(tmp_path):
    data = make_jpeg_bytes()
    p = tmp_path / "test.jpg"
    p.write_bytes(data)
    from services.media import process_image
    result = process_image(str(p))
    assert result.mime_type == "image/jpeg"
    assert result.media_type == "image"
    assert result.data == data


def test_process_png_returns_original_bytes(tmp_path):
    data = make_png_bytes()
    p = tmp_path / "test.png"
    p.write_bytes(data)
    from services.media import process_image
    result = process_image(str(p))
    assert result.mime_type == "image/png"
    assert result.media_type == "image"
    assert result.data == data


def test_process_webp_converts_to_jpeg(tmp_path):
    p = tmp_path / "test.webp"
    p.write_bytes(make_webp_bytes())
    from services.media import process_image
    result = process_image(str(p))
    assert result.mime_type == "image/jpeg"
    img = Image.open(io.BytesIO(result.data))
    assert img.format == "JPEG"


def test_process_static_gif_converts_to_jpeg(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_static_gif_bytes())
    from services.media import process_image
    result = process_image(str(p))
    assert result.mime_type == "image/jpeg"
    assert result.media_type == "image"


def test_process_static_apng_returns_png(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_static_apng_bytes())
    from services.media import process_image
    result = process_image(str(p))
    assert result.mime_type == "image/png"
    assert result.media_type == "image"
```

- [x] **Step 2: Run to verify failure**

```bash
pytest tests/test_media.py -v -k "classify or is_animated or process_jpeg or process_png or process_webp or process_static"
```
Expected: `ImportError` — `services.media` does not exist yet

- [x] **Step 3: Create services/media.py with image support**

```python
from __future__ import annotations

import io
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import imageio.v3 as iio
import numpy as np
from PIL import Image

MAX_VIDEO_SECONDS = 128.0

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp",
    ".png", ".apng",
    ".webp",
    ".gif",
}
VIDEO_EXTENSIONS = {
    ".mp4", ".m4v", ".mov",
    ".avi", ".mkv", ".wmv", ".flv", ".webm", ".3gp",
}
NATIVE_VIDEO_EXTS = {".mp4", ".m4v", ".mov"}


@dataclass
class ProcessedFile:
    data: bytes
    mime_type: str
    media_type: str  # "image" or "video"


def classify_extension(ext: str) -> Optional[str]:
    ext = ext.lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return None


def is_animated(path: str) -> bool:
    with Image.open(path) as img:
        return getattr(img, "n_frames", 1) > 1


def process_image(path: str) -> ProcessedFile:
    ext = Path(path).suffix.lower()
    if ext in {".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp"}:
        return ProcessedFile(data=Path(path).read_bytes(), mime_type="image/jpeg", media_type="image")
    if ext in {".png", ".apng"}:
        if is_animated(path):
            return ProcessedFile(data=_animated_to_mp4(path), mime_type="video/mp4", media_type="video")
        return ProcessedFile(data=Path(path).read_bytes(), mime_type="image/png", media_type="image")
    if ext == ".gif" and is_animated(path):
        return ProcessedFile(data=_animated_to_mp4(path), mime_type="video/mp4", media_type="video")
    with Image.open(path) as img:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG")
        return ProcessedFile(data=buf.getvalue(), mime_type="image/jpeg", media_type="image")


def _animated_to_mp4(path: str) -> bytes:
    frames = [np.array(Image.fromarray(f).convert("RGB")) for f in iio.imiter(path, plugin="pillow")]
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    try:
        iio.imwrite(tmp.name, frames, fps=10, codec="libx264", pixelformat="yuv420p")
        return Path(tmp.name).read_bytes()
    finally:
        os.unlink(tmp.name)


def process_video(path: str) -> ProcessedFile:
    ext = Path(path).suffix.lower()
    meta = iio.immeta(path, plugin="ffmpeg")
    duration = meta.get("duration", 0.0)
    fps = meta.get("fps", 24.0)

    if ext in NATIVE_VIDEO_EXTS and duration <= MAX_VIDEO_SECONDS:
        return ProcessedFile(data=Path(path).read_bytes(), mime_type="video/mp4", media_type="video")

    max_frames = int(MAX_VIDEO_SECONDS * fps)
    frames = []
    for i, frame in enumerate(iio.imiter(path, plugin="ffmpeg")):
        if i >= max_frames:
            break
        frames.append(frame)

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    try:
        iio.imwrite(tmp.name, frames, fps=fps, codec="libx264", pixelformat="yuv420p")
        return ProcessedFile(data=Path(tmp.name).read_bytes(), mime_type="video/mp4", media_type="video")
    finally:
        os.unlink(tmp.name)
```

- [x] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_media.py -v -k "classify or is_animated or process_jpeg or process_png or process_webp or process_static"
```
Expected: all selected tests pass

- [x] **Step 5: Commit**

```bash
git add services/media.py tests/test_media.py
git commit -m "feat: media processing - image classification and static conversion"
```

---

## Task 5: Media Processing — Animated Conversion and Video Truncation

**Files:**
- Modify: `tests/test_media.py` (add video tests)

`process_video` and `_animated_to_mp4` are already implemented in `services/media.py` from Task 4. This task adds tests to verify them.

- [x] **Step 1: Add video tests to tests/test_media.py**

Append to `tests/test_media.py`:
```python
# --- Animated image to video ---

def test_process_animated_gif_returns_mp4(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_animated_gif_bytes())
    from services.media import process_image
    result = process_image(str(p))
    assert result.mime_type == "video/mp4"
    assert result.media_type == "video"
    assert len(result.data) > 0


def test_process_animated_apng_returns_mp4(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_animated_apng_bytes())
    from services.media import process_image
    result = process_image(str(p))
    assert result.mime_type == "video/mp4"
    assert result.media_type == "video"


# --- Video processing ---

def test_process_short_mp4_returns_original_bytes(tmp_path):
    data = make_mp4_bytes(duration_seconds=1.0)
    p = tmp_path / "short.mp4"
    p.write_bytes(data)
    from services.media import process_video
    result = process_video(str(p))
    assert result.mime_type == "video/mp4"
    assert result.media_type == "video"
    assert result.data == data


def test_process_long_mp4_truncates_to_128s(tmp_path):
    import imageio.v3 as iio
    data = make_mp4_bytes(duration_seconds=200.0, fps=2)
    p = tmp_path / "long.mp4"
    p.write_bytes(data)
    from services.media import process_video, MAX_VIDEO_SECONDS
    result = process_video(str(p))
    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.write(result.data)
    out.close()
    meta = iio.immeta(out.name, plugin="ffmpeg")
    os.unlink(out.name)
    assert meta["duration"] <= MAX_VIDEO_SECONDS + 2  # 2s tolerance for encoding


def test_process_avi_converts_to_mp4(tmp_path):
    import imageio.v3 as iio
    frames = [np.zeros((10, 10, 3), dtype=np.uint8) for _ in range(5)]
    avi_path = str(tmp_path / "test.avi")
    iio.imwrite(avi_path, frames, fps=5, codec="rawvideo")
    from services.media import process_video
    result = process_video(avi_path)
    assert result.mime_type == "video/mp4"
    assert result.media_type == "video"
```

- [x] **Step 2: Run to verify pass**

```bash
pytest tests/test_media.py -v -k "animated or process_short or process_long or process_avi"
```
Expected: all pass

- [x] **Step 3: Commit**

```bash
git add tests/test_media.py
git commit -m "test: animated GIF/APNG to MP4 and video truncation"
```

---

## Task 6: Indexer Orchestration

**Files:**
- Rewrite: `services/indexer.py`
- Create: `tests/test_indexer.py`

- [x] **Step 1: Write failing tests**

`tests/test_indexer.py`:
```python
import io
from pathlib import Path
from unittest.mock import MagicMock

import chromadb
import pytest
from PIL import Image


@pytest.fixture
def media_root(tmp_path):
    """Creates tmp_path/data/media/photo.jpg, returns tmp_path as project root."""
    media = tmp_path / "data" / "media"
    media.mkdir(parents=True)
    img = Image.new("RGB", (10, 10), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    (media / "photo.jpg").write_bytes(buf.getvalue())
    return tmp_path


@pytest.fixture
def mock_services(monkeypatch):
    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.chroma.content_collection", content_col)
    monkeypatch.setattr("services.gemini.embed_content", lambda data, mime: [0.1] * 3072)
    return {"content": content_col}


def test_index_file_upserts_content_collection(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.indexer import index_file
    index_file("data/media/photo.jpg", force=False)
    result = mock_services["content"].get(ids=["data/media/photo.jpg"])
    assert result["ids"] == ["data/media/photo.jpg"]


def test_index_file_skips_already_indexed(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import upsert_content
    from services.indexer import index_file
    file_id = "data/media/photo.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "photo.jpg", "image/jpeg", "image")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file(file_id, force=False)
    embed_mock.assert_not_called()


def test_index_file_force_reindexes_existing(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.chroma import upsert_content
    from services.indexer import index_file
    file_id = "data/media/photo.jpg"
    upsert_content(file_id, [0.1] * 3072, file_id, "photo.jpg", "image/jpeg", "image")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    index_file(file_id, force=True)
    embed_mock.assert_called_once()


def test_index_file_skips_unsupported_extension(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    (media_root / "data" / "media" / "icon.svg").write_text("<svg/>")
    embed_mock = MagicMock(return_value=[0.1] * 3072)
    monkeypatch.setattr("services.gemini.embed_content", embed_mock)
    from services.indexer import index_file
    index_file("data/media/icon.svg", force=False)
    embed_mock.assert_not_called()


def test_run_indexes_all_files_in_media_dir(media_root, mock_services, monkeypatch):
    monkeypatch.chdir(media_root)
    from services.indexer import run
    run(force=False)
    result = mock_services["content"].get(ids=["data/media/photo.jpg"])
    assert result["ids"] == ["data/media/photo.jpg"]
```

- [x] **Step 2: Run to verify failure**

```bash
pytest tests/test_indexer.py -v
```
Expected: `ImportError` — `services.indexer.index_file` not yet defined

- [x] **Step 3: Implement services/indexer.py**

```python
import argparse
import logging
from pathlib import Path

from dotenv import load_dotenv

from services import chroma, gemini
from services.media import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    classify_extension,
    process_image,
    process_video,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

MEDIA_DIR = "data/media"


def index_file(path: str, force: bool) -> None:
    p = Path(path)
    file_id = str(p)
    ext = p.suffix.lower()

    if classify_extension(ext) is None:
        log.warning("skipped (unsupported): %s", path)
        return

    if not force and chroma.is_indexed(file_id):
        log.info("skipped (already indexed): %s", path)
        return

    try:
        processed = process_image(path) if ext in IMAGE_EXTENSIONS else process_video(path)
        content_embedding = gemini.embed_content(processed.data, processed.mime_type)

        chroma.upsert_content(
            file_id=file_id,
            embedding=content_embedding,
            path=path,
            filename=p.name,
            mime_type=processed.mime_type,
            media_type=processed.media_type,
        )
        log.info("indexed: %s", path)
    except Exception as exc:
        log.error("failed (%s): %s", type(exc).__name__, path)


def run(force: bool, db_path: str | None = None) -> None:
    if db_path is not None:
        chroma.configure(db_path)

    media_dir = Path(MEDIA_DIR)
    if not media_dir.exists():
        log.error("media directory not found: %s", MEDIA_DIR)
        return
    files = [f for f in media_dir.rglob("*") if f.is_file()]
    log.info("found %d files in %s", len(files), MEDIA_DIR)
    for f in files:
        index_file(str(f), force=force)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index media files into ChromaDB")
    parser.add_argument("--force", action="store_true", help="Re-index already-indexed files")
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to the ChromaDB persistent directory (default: data/databases)",
    )
    args = parser.parse_args()
    run(force=args.force, db_path=args.db_path)
```

- [x] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_indexer.py -v
```
Expected: 5 passed

- [x] **Step 5: Run full test suite**

```bash
pytest tests/ -v
```
Expected: all tests pass, no failures

- [x] **Step 6: Commit**

```bash
git add services/indexer.py tests/test_indexer.py
git commit -m "feat: indexer orchestration with skip/force logic"
```
