from __future__ import annotations

import io
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime
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


@dataclass
class FileMetadata:
    filename: str
    size_bytes: int
    modified: str
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[float] = None

    def to_text(self) -> str:
        parts = [
            f"filename: {self.filename}",
            f"size: {self.size_bytes / 1024 / 1024:.2f}MB",
            f"modified: {self.modified}",
        ]
        if self.width is not None and self.height is not None:
            parts.append(f"dimensions: {self.width}x{self.height}")
        if self.duration_seconds is not None:
            parts.append(f"duration: {self.duration_seconds:.1f}s")
        return " | ".join(parts)


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
    frames = []
    with Image.open(path) as img:
        for i in range(getattr(img, "n_frames", 1)):
            img.seek(i)
            frame = img.convert("RGB")
            frames.append(np.array(frame))
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    try:
        iio.imwrite(tmp.name, frames, fps=10, codec="libx264", pixelformat="yuv420p")
        return Path(tmp.name).read_bytes()
    finally:
        os.unlink(tmp.name)


def process_video(path: str) -> ProcessedFile:
    ext = Path(path).suffix.lower()
    meta = iio.immeta(path, plugin="FFMPEG")
    duration = meta.get("duration", 0.0)
    fps = meta.get("fps", 24.0)

    if ext in NATIVE_VIDEO_EXTS and duration <= MAX_VIDEO_SECONDS:
        return ProcessedFile(data=Path(path).read_bytes(), mime_type="video/mp4", media_type="video")

    max_frames = int(MAX_VIDEO_SECONDS * fps)
    frames = []
    for i, frame in enumerate(iio.imiter(path, plugin="FFMPEG")):
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


def extract_metadata(path: str) -> FileMetadata:
    p = Path(path)
    stat = p.stat()
    modified = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d")
    ext = p.suffix.lower()

    if ext in VIDEO_EXTENSIONS:
        meta = iio.immeta(path, plugin="FFMPEG")
        size = meta.get("size", None)  # (width, height)
        return FileMetadata(
            filename=p.name,
            size_bytes=stat.st_size,
            modified=modified,
            width=size[0] if size else None,
            height=size[1] if size else None,
            duration_seconds=meta.get("duration", None),
        )

    with Image.open(path) as img:
        width, height = img.size
    return FileMetadata(
        filename=p.name,
        size_bytes=stat.st_size,
        modified=modified,
        width=width,
        height=height,
    )
