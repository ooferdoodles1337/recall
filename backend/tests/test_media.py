import io
import os
import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from unittest.mock import MagicMock


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
    # Use distinct RGB colors converted to P so frames are not collapsed by GIF optimizer
    frames = [Image.new("RGB", (width, height), color=(i * 80, 0, 0)).convert("P") for i in range(n_frames)]
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
    # Use 16x16 frames (divisible by macro_block_size=16) to avoid ffmpeg resizing
    frames = [np.zeros((16, 16, 3), dtype=np.uint8) for _ in range(n_frames)]
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    iio.imwrite(tmp.name, frames, fps=fps, codec="libx264", pixelformat="yuv420p")
    data = Path(tmp.name).read_bytes()
    os.unlink(tmp.name)
    return data


# --- Extension classification ---

def test_classify_jpeg_extensions():
    from services.pipeline.media import classify_extension
    for ext in [".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp"]:
        assert classify_extension(ext) == "image", f"Expected image for {ext}"


def test_classify_png():
    from services.pipeline.media import classify_extension
    assert classify_extension(".png") == "image"
    assert classify_extension(".apng") == "image"


def test_classify_webp_and_gif():
    from services.pipeline.media import classify_extension
    assert classify_extension(".webp") == "image"
    assert classify_extension(".gif") == "image"


def test_classify_video_extensions():
    from services.pipeline.media import classify_extension
    for ext in [".mp4", ".m4v", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".3gp"]:
        assert classify_extension(ext) == "video", f"Expected video for {ext}"


def test_classify_unknown_returns_none():
    from services.pipeline.media import classify_extension
    assert classify_extension(".svg") is None
    assert classify_extension(".txt") is None
    assert classify_extension(".pdf") is None


# --- Animated detection ---

def test_is_animated_false_for_static_gif(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_static_gif_bytes())
    from services.pipeline.media import is_animated
    assert is_animated(str(p)) is False


def test_is_animated_true_for_animated_gif(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_animated_gif_bytes())
    from services.pipeline.media import is_animated
    assert is_animated(str(p)) is True


def test_is_animated_false_for_static_apng(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_static_apng_bytes())
    from services.pipeline.media import is_animated
    assert is_animated(str(p)) is False


def test_is_animated_true_for_animated_apng(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_animated_apng_bytes())
    from services.pipeline.media import is_animated
    assert is_animated(str(p)) is True


# --- Static image processing ---

def test_process_jpeg_returns_original_bytes(tmp_path):
    data = make_jpeg_bytes()
    p = tmp_path / "test.jpg"
    p.write_bytes(data)
    from services.pipeline.media import process_image
    result = process_image(str(p))
    assert result.embedding_mime == "image/jpeg"
    assert result.media_type == "image"
    assert result.data == data


def test_process_png_returns_original_bytes(tmp_path):
    data = make_png_bytes()
    p = tmp_path / "test.png"
    p.write_bytes(data)
    from services.pipeline.media import process_image
    result = process_image(str(p))
    assert result.embedding_mime == "image/png"
    assert result.media_type == "image"
    assert result.data == data


def test_process_webp_converts_to_jpeg(tmp_path):
    p = tmp_path / "test.webp"
    p.write_bytes(make_webp_bytes())
    from services.pipeline.media import process_image
    result = process_image(str(p))
    assert result.embedding_mime == "image/jpeg"
    img = Image.open(io.BytesIO(result.data))
    assert img.format == "JPEG"


def test_process_static_gif_converts_to_jpeg(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_static_gif_bytes())
    from services.pipeline.media import process_image
    result = process_image(str(p))
    assert result.embedding_mime == "image/jpeg"
    assert result.media_type == "image"


def test_process_static_apng_returns_png(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_static_apng_bytes())
    from services.pipeline.media import process_image
    result = process_image(str(p))
    assert result.embedding_mime == "image/png"
    assert result.media_type == "image"


# --- Animated image to video ---

def test_process_animated_gif_returns_mp4(tmp_path):
    p = tmp_path / "test.gif"
    p.write_bytes(make_animated_gif_bytes())
    from services.pipeline.media import process_image
    result = process_image(str(p))
    assert result.embedding_mime == "video/mp4"
    assert result.media_type == "video"
    assert len(result.data) > 0


def test_process_animated_apng_returns_mp4(tmp_path):
    p = tmp_path / "test.apng"
    p.write_bytes(make_animated_apng_bytes())
    from services.pipeline.media import process_image
    result = process_image(str(p))
    assert result.embedding_mime == "video/mp4"
    assert result.media_type == "video"


# --- Video processing ---

def test_process_short_mp4_returns_original_bytes(tmp_path):
    data = make_mp4_bytes(duration_seconds=1.0)
    p = tmp_path / "short.mp4"
    p.write_bytes(data)
    from services.pipeline.media import process_video
    result = process_video(str(p))
    assert result.embedding_mime == "video/mp4"
    assert result.media_type == "video"
    assert result.data == data


def test_process_long_mp4_truncates_to_128s(tmp_path):
    import imageio.v3 as iio
    data = make_mp4_bytes(duration_seconds=200.0, fps=2)
    p = tmp_path / "long.mp4"
    p.write_bytes(data)
    from services.pipeline.media import process_video, MAX_VIDEO_SECONDS
    result = process_video(str(p))
    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.write(result.data)
    out.close()
    meta = iio.immeta(out.name, plugin="FFMPEG")
    os.unlink(out.name)
    assert meta["duration"] <= MAX_VIDEO_SECONDS + 2  # 2s tolerance for encoding


def test_process_avi_converts_to_mp4(tmp_path):
    import imageio.v3 as iio
    frames = [np.zeros((10, 10, 3), dtype=np.uint8) for _ in range(5)]
    avi_path = str(tmp_path / "test.avi")
    iio.imwrite(avi_path, frames, fps=5, codec="rawvideo")
    from services.pipeline.media import process_video
    result = process_video(avi_path)
    assert result.embedding_mime == "video/mp4"
    assert result.media_type == "video"


def test_process_non_native_video_uses_ffmpeg_transcoder(monkeypatch):
    from services.pipeline import media

    transcode_mock = MagicMock(return_value=b"mp4-bytes")
    monkeypatch.setattr(media.iio, "immeta", lambda path, plugin: {"duration": 1.0})
    monkeypatch.setattr(media, "_run_ffmpeg_to_mp4", transcode_mock)

    result = media.process_video("test.avi")

    assert result.data == b"mp4-bytes"
    transcode_mock.assert_called_once_with("test.avi", max_seconds=media.MAX_VIDEO_SECONDS)


def test_process_large_native_video_uses_ffmpeg_transcoder(tmp_path, monkeypatch):
    from services.pipeline import media

    p = tmp_path / "large.mp4"
    p.write_bytes(b"larger-than-test-limit")
    transcode_mock = MagicMock(return_value=b"compressed-mp4")
    monkeypatch.setattr(media, "MAX_EMBED_VIDEO_BYTES", 10)
    monkeypatch.setattr(media.iio, "immeta", lambda path, plugin: {"duration": 1.0})
    monkeypatch.setattr(media, "_run_ffmpeg_to_mp4", transcode_mock)

    result = media.process_video(str(p))

    assert result.data == b"compressed-mp4"
    transcode_mock.assert_called_once_with(str(p), max_seconds=media.MAX_VIDEO_SECONDS)


# --- Thumbnail generation ---

def test_generate_thumbnail_image_returns_webp(tmp_path):
    p = tmp_path / "test.jpg"
    p.write_bytes(make_jpeg_bytes(width=640, height=480))
    from services.pipeline.media import generate_thumbnail
    result = generate_thumbnail(str(p), "image")
    thumb = Image.open(io.BytesIO(result))
    assert thumb.format == "WEBP"
    assert max(thumb.size) <= 320


def test_generate_thumbnail_image_preserves_aspect_ratio(tmp_path):
    p = tmp_path / "test.jpg"
    p.write_bytes(make_jpeg_bytes(width=640, height=320))
    from services.pipeline.media import generate_thumbnail
    result = generate_thumbnail(str(p), "image")
    thumb = Image.open(io.BytesIO(result))
    assert thumb.size == (320, 160)


def test_generate_thumbnail_small_image_not_upscaled(tmp_path):
    p = tmp_path / "test.jpg"
    p.write_bytes(make_jpeg_bytes(width=100, height=80))
    from services.pipeline.media import generate_thumbnail
    result = generate_thumbnail(str(p), "image")
    thumb = Image.open(io.BytesIO(result))
    assert thumb.size == (100, 80)


def test_generate_thumbnail_video_returns_webp():
    import numpy as np
    from unittest.mock import patch
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    with patch("services.pipeline.media.iio.imread", return_value=frame):
        from services.pipeline.media import generate_thumbnail
        result = generate_thumbnail("fake.mp4", "video")
    thumb = Image.open(io.BytesIO(result))
    assert thumb.format == "WEBP"
    assert max(thumb.size) <= 320


# --- Display renditions (HEIC) ---

def make_heic_bytes(width=10, height=10) -> bytes:
    # register_heif_opener() runs on import of services.pipeline.media
    import services.pipeline.media  # noqa: F401
    img = Image.new("RGB", (width, height), color=(120, 60, 200))
    buf = io.BytesIO()
    try:
        img.save(buf, format="HEIF")
    except (OSError, ValueError) as exc:
        pytest.skip(f"HEIF encoding unavailable: {exc}")
    return buf.getvalue()


def test_needs_display_rendition_for_heic():
    from services.pipeline.media import needs_display_rendition
    assert needs_display_rendition("photo.heic") is True
    assert needs_display_rendition("photo.HEIF") is True
    assert needs_display_rendition("photo.jpg") is False
    assert needs_display_rendition("clip.mp4") is False


def test_generate_display_returns_none_for_web_native(tmp_path):
    p = tmp_path / "test.jpg"
    p.write_bytes(make_jpeg_bytes())
    from services.pipeline.media import generate_display
    assert generate_display(str(p)) is None


def test_generate_display_heic_returns_webp(tmp_path):
    p = tmp_path / "test.heic"
    p.write_bytes(make_heic_bytes(width=64, height=48))
    from services.pipeline.media import generate_display
    result = generate_display(str(p))
    assert result is not None
    img = Image.open(io.BytesIO(result))
    assert img.format == "WEBP"
    assert img.size == (64, 48)


def test_generate_display_heic_downscales_long_edge(tmp_path):
    from services.pipeline.media import DISPLAY_RENDITION_MAX_EDGE, generate_display
    p = tmp_path / "big.heic"
    p.write_bytes(make_heic_bytes(width=4000, height=2000))
    result = generate_display(str(p))
    assert result is not None
    img = Image.open(io.BytesIO(result))
    assert max(img.size) == DISPLAY_RENDITION_MAX_EDGE
    assert img.size == (DISPLAY_RENDITION_MAX_EDGE, DISPLAY_RENDITION_MAX_EDGE // 2)
