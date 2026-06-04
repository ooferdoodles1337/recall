import asyncio
import logging
import random
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel

import config
from services.catalog import db as catalog
from services.catalog import schema as metadata_schema
from services.providers import gemini_annotation
from services.pipeline.media import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    ProcessedFile,
    process_image,
    process_video,
)

load_dotenv()
log = logging.getLogger(__name__)

ANNOTATION_MODEL = "gemini-3.1-flash-lite"
IMAGE_PACK_SIZE = 10
VIDEO_PACK_SIZE = 5
ANNOTATION_CONCURRENCY = 3
_ANIMATED_IMAGE_EXTENSIONS = {".gif", ".apng"}
_GEMINI_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"}
_TEMP_SUFFIX_BY_MIME_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
}


@dataclass(frozen=True)
class AnnotationMedia:
    file_id: str
    path: Path
    mime_type: str
    temporary: bool = False

    def as_provider_tuple(self) -> tuple[str, Path, str]:
        return (self.file_id, self.path, self.mime_type)


@dataclass(frozen=True)
class _CompletedAnnotationPack:
    pack_idx: int
    loaded_count: int
    expected_ids: set[str]
    annotations: dict[str, "SingleImageAnnotation"]


def _item_annotation_mime_type(item: dict) -> str:
    meta = item["metadata"] or {}
    mime_type = metadata_schema.mime_type(meta) or ""
    path = metadata_schema.asset_path(meta) or ""
    ext = Path(path).suffix.lower()

    if ext in _ANIMATED_IMAGE_EXTENSIONS:
        return "video/mp4"
    return mime_type


def _make_gemini_packs(
    items: list[dict],
) -> list[list[dict]]:
    images = [item for item in items if not _item_annotation_mime_type(item).startswith("video/")]
    videos = [item for item in items if _item_annotation_mime_type(item).startswith("video/")]
    packs = [images[i:i + IMAGE_PACK_SIZE] for i in range(0, len(images), IMAGE_PACK_SIZE)]
    packs += [videos[i:i + VIDEO_PACK_SIZE] for i in range(0, len(videos), VIDEO_PACK_SIZE)]
    return [p for p in packs if p]

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "annotation.txt"
_ANNOTATION_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")


class SingleImageAnnotation(BaseModel):
    file_id: str
    description: str
    search_terms: list[str]


class PackedAnnotationResponse(BaseModel):
    annotations: list[SingleImageAnnotation]


def _get_unannotated(file_ids: list[str] | set[str] | None = None) -> list[dict]:
    all_items = catalog.get_all_items_with_metadata()
    requested = set(file_ids) if file_ids is not None else None
    return [
        item for item in all_items
        if (requested is None or item["id"] in requested)
        and not metadata_schema.search_description(item["metadata"] or {})
    ]


def _write_temp_processed_media(file_id: str, processed: ProcessedFile) -> AnnotationMedia:
    suffix = _TEMP_SUFFIX_BY_MIME_TYPE.get(processed.embedding_mime, ".bin")
    with tempfile.NamedTemporaryFile(prefix=f"recall-annotation-{file_id}-", suffix=suffix, delete=False) as f:
        f.write(processed.data)
        path = Path(f.name)
    return AnnotationMedia(file_id=file_id, path=path, mime_type=processed.embedding_mime, temporary=True)


def _load_item_file(item: dict) -> AnnotationMedia | None:
    meta = item["metadata"] or {}
    path = metadata_schema.asset_path(meta)
    mime_type = metadata_schema.mime_type(meta)
    if not path or not mime_type:
        log.warning("item %s missing path or mime_type", item["id"])
        return None
    media_path = config.DATA_DIR / path
    if not media_path.is_file():
        log.error("media file does not exist: %s", media_path)
        return None

    ext = media_path.suffix.lower()
    if ext in _ANIMATED_IMAGE_EXTENSIONS or (
        ext in IMAGE_EXTENSIONS and mime_type.startswith("image/") and mime_type not in _GEMINI_IMAGE_MIME_TYPES
    ):
        try:
            processed = process_image(str(media_path))
        except Exception as exc:
            log.error("failed to prepare annotation image %s: %s", media_path, exc)
            return None
        return _write_temp_processed_media(item["id"], processed)

    if ext in VIDEO_EXTENSIONS and mime_type != "video/mp4":
        try:
            processed = process_video(str(media_path))
        except Exception as exc:
            log.error("failed to prepare annotation video %s: %s", media_path, exc)
            return None
        return _write_temp_processed_media(item["id"], processed)

    # Non-ASCII filenames cause HTTP header encoding errors in the upload API.
    if not media_path.name.isascii():
        suffix = _TEMP_SUFFIX_BY_MIME_TYPE.get(mime_type, media_path.suffix)
        with tempfile.NamedTemporaryFile(
            prefix=f"recall-annotation-{item['id']}-", suffix=suffix, delete=False
        ) as f:
            f.write(media_path.read_bytes())
            return AnnotationMedia(file_id=item["id"], path=Path(f.name), mime_type=mime_type, temporary=True)

    return AnnotationMedia(file_id=item["id"], path=media_path, mime_type=mime_type)


def _cleanup_loaded_media(loaded: list[AnnotationMedia]) -> None:
    for media in loaded:
        if media.temporary:
            media.path.unlink(missing_ok=True)


def _write_annotations(
    annotations: dict[str, SingleImageAnnotation],
    expected_ids: set[str],
    *,
    provider: str = "gemini",
    model: str = ANNOTATION_MODEL,
) -> None:
    for file_id, annotation in annotations.items():
        if file_id not in expected_ids:
            log.warning("unexpected file_id in response: %s", file_id)
            continue
        try:
            catalog.update_metadata(
                file_id,
                metadata_schema.annotation_patch(
                    description=annotation.description,
                    phrases=annotation.search_terms,
                    provider=provider,
                    model=model,
                ),
            )
        except Exception as exc:
            log.error("failed to write annotation for %s: %s", file_id, exc)

    if len(annotations) < len(expected_ids):
        log.warning("%d items were not annotated (expected %d)", len(expected_ids) - len(annotations), len(expected_ids))


async def _annotate_pack_items_async(
    *,
    pack_idx: int,
    pack_count: int,
    pack_items: list[dict],
    model: str,
) -> _CompletedAnnotationPack | None:
    loaded_results = await asyncio.gather(*(asyncio.to_thread(_load_item_file, item) for item in pack_items))
    loaded = [x for x in loaded_results if x is not None]
    if not loaded:
        return None

    expected_ids = {media.file_id for media in loaded}
    started_at = time.monotonic()
    log.info(
        "annotating pack %d/%d: items=%d model=%s",
        pack_idx,
        pack_count,
        len(loaded),
        model,
    )
    try:
        text = await gemini_annotation.annotate_pack_async(
            [media.as_provider_tuple() for media in loaded],
            model,
            _ANNOTATION_PROMPT,
            PackedAnnotationResponse.model_json_schema(),
        )
        parsed = PackedAnnotationResponse.model_validate_json(text)
    finally:
        _cleanup_loaded_media(loaded)

    annotations = {ann.file_id: ann for ann in parsed.annotations}
    log.info(
        "annotation pack %d/%d returned: %d/%d items elapsed=%.1fs",
        pack_idx,
        pack_count,
        len(annotations),
        len(loaded),
        time.monotonic() - started_at,
    )
    return _CompletedAnnotationPack(
        pack_idx=pack_idx,
        loaded_count=len(loaded),
        expected_ids=expected_ids,
        annotations=annotations,
    )


async def annotate_unannotated_async(
    limit: int | None = None,
    file_ids: list[str] | set[str] | None = None,
    annotation_concurrency: int = ANNOTATION_CONCURRENCY,
) -> None:
    if annotation_concurrency <= 0:
        raise ValueError("annotation_concurrency must be positive")

    started_at = time.monotonic()
    unannotated = _get_unannotated(file_ids=file_ids)
    if not unannotated:
        log.info("all requested items already annotated")
        return

    if limit is not None and limit < len(unannotated):
        total = len(unannotated)
        unannotated = random.sample(unannotated, limit)
        log.info("sample run: annotating %d/%d unannotated items", limit, total)

    log.info("annotating %d items", len(unannotated))

    provider = "gemini"
    model = ANNOTATION_MODEL

    packs = _make_gemini_packs(unannotated)
    log.info("built %d packs", len(packs))

    annotated_count = 0
    loaded_count = 0

    def write_completed(result: _CompletedAnnotationPack | None) -> None:
        nonlocal annotated_count, loaded_count
        if result is None:
            return
        loaded_count += result.loaded_count
        _write_annotations(result.annotations, result.expected_ids, provider=provider, model=model)
        annotated_count += len(set(result.annotations) & result.expected_ids)
        log.info(
            "annotation pack %d/%d complete: %d/%d items annotated",
            result.pack_idx,
            len(packs),
            len(result.annotations),
            result.loaded_count,
        )

    if annotation_concurrency == 1 or len(packs) == 1:
        for pack_idx, pack_items in enumerate(packs, start=1):
            try:
                write_completed(await _annotate_pack_items_async(
                    pack_idx=pack_idx,
                    pack_count=len(packs),
                    pack_items=pack_items,
                    model=ANNOTATION_MODEL,
                ))
            except Exception as exc:
                log.error("pack %d failed: %s", pack_idx, exc)
    else:
        max_workers = min(annotation_concurrency, len(packs))
        log.info("annotation concurrency: %d workers", max_workers)
        semaphore = asyncio.Semaphore(max_workers)

        async def run_pack(
            pack_idx: int,
            pack_items: list[dict],
        ) -> tuple[int, _CompletedAnnotationPack | None, Exception | None]:
            async with semaphore:
                try:
                    result = await _annotate_pack_items_async(
                        pack_idx=pack_idx,
                        pack_count=len(packs),
                        pack_items=pack_items,
                        model=ANNOTATION_MODEL,
                    )
                    return pack_idx, result, None
                except Exception as exc:
                    return pack_idx, None, exc

        tasks = [
            asyncio.create_task(run_pack(pack_idx, pack_items))
            for pack_idx, pack_items in enumerate(packs, start=1)
        ]
        for task in asyncio.as_completed(tasks):
            pack_idx, result, exc = await task
            if exc is not None:
                log.error("pack %d failed: %s", pack_idx, exc)
                continue
            write_completed(result)

    log.info(
        "annotation complete: %d/%d items annotated in %d packs, elapsed=%.1fs",
        annotated_count,
        loaded_count,
        len(packs),
        time.monotonic() - started_at,
    )


def annotate_unannotated(
    limit: int | None = None,
    file_ids: list[str] | set[str] | None = None,
    annotation_concurrency: int = ANNOTATION_CONCURRENCY,
) -> None:
    """Annotate from synchronous callers such as the indexer CLI."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(annotate_unannotated_async(
            limit=limit,
            file_ids=file_ids,
            annotation_concurrency=annotation_concurrency,
        ))
    raise RuntimeError(
        "annotate_unannotated() cannot run inside an active event loop; "
        "await annotate_unannotated_async() instead"
    )
