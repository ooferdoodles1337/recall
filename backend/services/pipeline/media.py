from __future__ import annotations

import io
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import imageio_ffmpeg
import imageio.v3 as iio
from PIL import Image, ImageOps, ImageSequence
from pillow_heif import register_heif_opener

import config

register_heif_opener()

log = logging.getLogger(__name__)

MAX_VIDEO_SECONDS = config.MAX_VIDEO_SECONDS
MAX_EMBED_VIDEO_BYTES = 48 * 1024 * 1024

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp",
    ".png", ".apng",
    ".webp",
    ".gif",
    ".heic", ".heif",
}
HEIC_EXTENSIONS = {".heic", ".heif"}
VIDEO_EXTENSIONS = {
    ".mp4", ".m4v", ".mov",
    ".avi", ".mkv", ".wmv", ".flv", ".webm", ".3gp",
}
NATIVE_VIDEO_EXTS = {".mp4", ".m4v", ".mov"}


@dataclass
class ProcessedFile:
    data: bytes
    embedding_mime: str  # MIME type of `data` as prepared for embedding (may differ from disk MIME)
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


def _heic_to_jpeg_bytes(path: str) -> bytes:
    with Image.open(path) as img:
        buf = io.BytesIO()
        ImageOps.exif_transpose(img).convert("RGB").save(buf, format="JPEG")
        return buf.getvalue()


def process_image(path: str) -> ProcessedFile:
    ext = Path(path).suffix.lower()
    if ext in HEIC_EXTENSIONS:
        return ProcessedFile(data=_heic_to_jpeg_bytes(path), embedding_mime="image/jpeg", media_type="image")
    if ext in {".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp"}:
        return ProcessedFile(data=Path(path).read_bytes(), embedding_mime="image/jpeg", media_type="image")
    if ext in {".png", ".apng"}:
        if is_animated(path):
            return ProcessedFile(data=_animated_to_mp4(path), embedding_mime="video/mp4", media_type="video")
        return ProcessedFile(data=Path(path).read_bytes(), embedding_mime="image/png", media_type="image")
    if ext == ".gif" and is_animated(path):
        return ProcessedFile(data=_animated_to_mp4(path), embedding_mime="video/mp4", media_type="video")
    with Image.open(path) as img:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG")
        return ProcessedFile(data=buf.getvalue(), embedding_mime="image/jpeg", media_type="image")


def _run_ffmpeg_to_mp4(
    path: str,
    *,
    max_seconds: float | None = None,
    max_bytes: int | None = MAX_EMBED_VIDEO_BYTES,
) -> bytes:
    attempts = [
        {"height": 720, "crf": 28},
        {"height": 540, "crf": 32},
        {"height": 360, "crf": 35},
    ]
    last_data: bytes | None = None
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    try:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        for attempt in attempts:
            cmd = [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-i",
                path,
                "-map",
                "0:v:0",
                "-an",
            ]
            if max_seconds is not None:
                cmd.extend(["-t", str(max_seconds)])
            cmd.extend([
                "-vf",
                f"scale=-2:min({attempt['height']}\\,ih),pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                str(attempt["crf"]),
                "-movflags",
                "+faststart",
                tmp.name,
            ])
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)
            if result.returncode != 0:
                stderr = result.stderr.strip() or "unknown ffmpeg error"
                raise RuntimeError(f"ffmpeg transcode failed for {path}: {stderr}")

            last_data = Path(tmp.name).read_bytes()
            if max_bytes is None or len(last_data) <= max_bytes:
                return last_data

        if last_data is None:
            raise RuntimeError(f"ffmpeg transcode did not produce output for {path}")
        raise RuntimeError(
            f"ffmpeg transcode for {path} is still too large: {len(last_data):,} bytes "
            f"(limit {max_bytes:,} bytes)"
        )
    finally:
        os.unlink(tmp.name)


def _animated_to_mp4(path: str) -> bytes:
    return _run_ffmpeg_to_mp4(path, max_seconds=MAX_VIDEO_SECONDS)


ANIMATED_IMAGE_EXTS = {".gif", ".apng"}


def generate_thumbnail(path: str, media_type: str) -> bytes:
    ext = Path(path).suffix.lower()
    if ext in ANIMATED_IMAGE_EXTS:
        with Image.open(path) as raw:
            img = raw.convert("RGB")
    elif media_type == "video":
        frame = iio.imread(path, index=0, plugin="FFMPEG")
        img = Image.fromarray(frame).convert("RGB")
    else:
        with Image.open(path) as raw:
            img = ImageOps.exif_transpose(raw).convert("RGB")
    img.thumbnail((320, 320), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP")
    return buf.getvalue()


ANIMATED_THUMBNAIL_MAX_SOURCE_BYTES = 5 * 1024 * 1024  # skip GIFs larger than 5 MB
ANIMATED_THUMBNAIL_MAX_FRAMES = 200                     # cap frame extraction


def generate_animated_thumbnail(
    path: str,
    *,
    max_source_bytes: int = ANIMATED_THUMBNAIL_MAX_SOURCE_BYTES,
) -> bytes | None:
    """Generate an animated WebP thumbnail for a GIF/animated image.

    Returns None if the source is too large, not animated, or on any error.
    The static thumbnail is unaffected regardless of the outcome here.
    """
    try:
        if Path(path).stat().st_size > max_source_bytes:
            return None
        with Image.open(path) as img:
            n_frames = getattr(img, "n_frames", 1)
            if n_frames <= 1:
                return None
            frames: list[Image.Image] = []
            durations: list[int] = []
            for i, frame in enumerate(ImageSequence.Iterator(img)):
                if i >= ANIMATED_THUMBNAIL_MAX_FRAMES:
                    break
                copy = frame.copy().convert("RGBA")
                copy.thumbnail((320, 320), Image.Resampling.LANCZOS)
                frames.append(copy)
                durations.append(int(img.info.get("duration", 100)))
            if not frames:
                return None
            buf = io.BytesIO()
            frames[0].save(
                buf,
                format="WEBP",
                save_all=True,
                append_images=frames[1:],
                duration=durations,
                loop=0,
                lossless=False,
                quality=75,
            )
            return buf.getvalue()
    except Exception as exc:
        log.warning("animated thumbnail failed for %s: %s", path, exc, exc_info=True)
        return None


def process_video(path: str) -> ProcessedFile:
    ext = Path(path).suffix.lower()
    meta = iio.immeta(path, plugin="FFMPEG")
    duration = meta.get("duration", 0.0)

    if (
        ext in NATIVE_VIDEO_EXTS
        and duration <= MAX_VIDEO_SECONDS
        and Path(path).stat().st_size <= MAX_EMBED_VIDEO_BYTES
    ):
        return ProcessedFile(data=Path(path).read_bytes(), embedding_mime="video/mp4", media_type="video")

    return ProcessedFile(
        data=_run_ffmpeg_to_mp4(path, max_seconds=MAX_VIDEO_SECONDS),
        embedding_mime="video/mp4",
        media_type="video",
    )
