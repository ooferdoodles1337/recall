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


def generate_thumbnail(path: str, media_type: str) -> bytes:
    if media_type == "video":
        frame = iio.imread(path, index=0, plugin="FFMPEG")
        img = Image.fromarray(frame).convert("RGB")
    else:
        with Image.open(path) as raw:
            img = raw.convert("RGB")
    img.thumbnail((320, 320), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP")
    return buf.getvalue()


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
