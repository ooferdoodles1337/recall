import logging
import time
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel

import config
from services.catalog import db as catalog
from services.catalog import schema as metadata_schema
from services.providers import gemini_annotation
from services.utils import format_bytes

load_dotenv()
log = logging.getLogger(__name__)

ANNOTATION_MODEL = "gemini-3.1-flash-lite"
IMAGE_PACK_SIZE = 50
VIDEO_PACK_SIZE = 5
GEMINI_SUBMISSION_PACK_LIMIT = 50
GEMINI_SUBMISSION_MEDIA_BYTE_TARGET = 512 * 1024 * 1024


def _make_gemini_packs(
    loaded: list[tuple[str, bytes, str]],
) -> list[list[tuple[str, bytes, str]]]:
    images = [item for item in loaded if not item[2].startswith("video/")]
    videos = [item for item in loaded if item[2].startswith("video/")]
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


def _get_unannotated() -> list[dict]:
    all_items = catalog.get_all_items_with_metadata()
    return [item for item in all_items if not metadata_schema.search_description(item["metadata"] or {})]


def _load_item_bytes(item: dict) -> tuple[str, bytes, str] | None:
    meta = item["metadata"] or {}
    path = metadata_schema.asset_path(meta)
    mime_type = metadata_schema.mime_type(meta)
    if not path or not mime_type:
        log.warning("item %s missing path or mime_type", item["id"])
        return None
    try:
        return (item["id"], (config.DATA_DIR / path).read_bytes(), mime_type)
    except Exception as exc:
        log.error("failed to load %s: %s", path, exc)
        return None


def _parse_pack_results(raw_results: list[str | None]) -> dict[str, SingleImageAnnotation]:
    annotations: dict[str, SingleImageAnnotation] = {}
    for i, text in enumerate(raw_results):
        if text is None:
            continue
        try:
            parsed = PackedAnnotationResponse.model_validate_json(text)
            for annotation in parsed.annotations:
                annotations[annotation.file_id] = annotation
        except Exception as exc:
            log.error("pack %d parse error: %s", i, exc)
    return annotations


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


def annotate_unannotated() -> None:
    started_at = time.monotonic()
    unannotated = _get_unannotated()
    if not unannotated:
        log.info("all items already annotated")
        return

    log.info("annotating %d items", len(unannotated))
    expected_ids = {item["id"] for item in unannotated}

    provider = "gemini"
    model = ANNOTATION_MODEL

    loaded = [x for x in (_load_item_bytes(item) for item in unannotated) if x is not None]
    loaded_count = len(loaded)
    log.info("loaded %d/%d items", loaded_count, len(unannotated))

    packs = _make_gemini_packs(loaded)
    log.info("built %d packs", len(packs))

    submission_count = 0
    annotated_count = 0
    pending_packs: list[list[tuple[str, bytes, str]]] = []
    pending_bytes = 0

    def submit_pending() -> None:
        nonlocal annotated_count, pending_packs, pending_bytes, submission_count
        if not pending_packs:
            return
        submission_count += 1
        submission_ids = {file_id for pack in pending_packs for file_id, _, _ in pack}
        log.info(
            "submitting annotation batch %d: packs=%d items=%d media=%s model=%s",
            submission_count,
            len(pending_packs),
            len(submission_ids),
            format_bytes(pending_bytes),
            ANNOTATION_MODEL,
        )
        raw_results = gemini_annotation.annotate_packs_batch(
            pending_packs, ANNOTATION_MODEL, _ANNOTATION_PROMPT, PackedAnnotationResponse.model_json_schema()
        )
        annotations = _parse_pack_results(raw_results)
        _write_annotations(annotations, submission_ids, provider=provider, model=model)
        annotated_count += len(annotations)
        log.info(
            "annotation batch %d complete: %d/%d items annotated",
            submission_count,
            len(annotations),
            len(submission_ids),
        )
        pending_packs = []
        pending_bytes = 0

    for pack in packs:
        pack_bytes = sum(len(item[1]) for item in pack)
        if pending_packs and (
            len(pending_packs) >= GEMINI_SUBMISSION_PACK_LIMIT
            or pending_bytes + pack_bytes > GEMINI_SUBMISSION_MEDIA_BYTE_TARGET
        ):
            submit_pending()
        pending_packs.append(pack)
        pending_bytes += pack_bytes

    submit_pending()
    log.info(
        "annotation complete: %d/%d items annotated in %d submissions, elapsed=%.1fs",
        annotated_count,
        loaded_count,
        submission_count,
        time.monotonic() - started_at,
    )
