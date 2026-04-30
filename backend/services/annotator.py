import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel

import config
from services import catalog, gemini, openrouter

load_dotenv()
log = logging.getLogger(__name__)

ANNOTATION_MODEL = "gemini-3.1-flash-lite-preview"
PACK_SIZE = 10
OPENROUTER_IMAGE_PACK_SIZE = 8  # Nvidia provider limit


def _make_openrouter_packs(
    loaded: list[tuple[str, bytes, str]],
) -> list[list[tuple[str, bytes, str]]]:
    images = [item for item in loaded if not item[2].startswith("video/")]
    videos = [item for item in loaded if item[2].startswith("video/")]
    packs = [images[i:i + OPENROUTER_IMAGE_PACK_SIZE] for i in range(0, len(images), OPENROUTER_IMAGE_PACK_SIZE)]
    packs += [[v] for v in videos]  # videos must be sent one per request
    return [p for p in packs if p]

_PROMPT_PATH = Path(__file__).parent / "prompts" / "annotation.txt"
_ANNOTATION_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")


class SingleImageAnnotation(BaseModel):
    file_id: str
    description: str
    search_terms: list[str]


class PackedAnnotationResponse(BaseModel):
    annotations: list[SingleImageAnnotation]


def _inline_schema(schema: dict) -> dict:
    """Resolve $ref/$defs into an inline JSON schema for annotation providers."""
    defs = schema.get("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(defs[node["$ref"].split("/")[-1]])
            return {k: resolve(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


def _get_unannotated() -> list[dict]:
    all_items = catalog.get_all_items_with_metadata()
    return [item for item in all_items if not (item["metadata"] or {}).get("description")]


def _load_item_bytes(item: dict) -> tuple[str, bytes, str] | None:
    meta = item["metadata"] or {}
    path = meta.get("path")
    mime_type = meta.get("mime_type")
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


def _write_annotations(annotations: dict[str, SingleImageAnnotation], expected_ids: set[str]) -> None:
    for file_id, annotation in annotations.items():
        if file_id not in expected_ids:
            log.warning("unexpected file_id in response: %s", file_id)
            continue
        try:
            catalog.update_metadata(file_id, {
                "description": annotation.description,
                "search_terms": json.dumps(annotation.search_terms),
            })
        except Exception as exc:
            log.error("failed to write annotation for %s: %s", file_id, exc)

    if len(annotations) < len(expected_ids):
        log.warning("%d items were not annotated (expected %d)", len(expected_ids) - len(annotations), len(expected_ids))


def annotate_unannotated() -> None:
    unannotated = _get_unannotated()
    if not unannotated:
        log.info("all items already annotated")
        return

    log.info("annotating %d items", len(unannotated))
    expected_ids = {item["id"] for item in unannotated}

    loaded = [x for x in (_load_item_bytes(item) for item in unannotated) if x is not None]

    if os.getenv("OPENROUTER_API_KEY"):
        model = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
        packs = _make_openrouter_packs(loaded)
        log.info("annotating %d packs via OpenRouter (%s)", len(packs), model)
        raw_results = openrouter.annotate_packs(packs, model, _ANNOTATION_PROMPT, PackedAnnotationResponse.model_json_schema())
    else:
        packs = [loaded[i:i + PACK_SIZE] for i in range(0, len(loaded), PACK_SIZE)]
        log.info("submitting %d packs to Gemini Batch API (%s)", len(packs), ANNOTATION_MODEL)
        raw_results = gemini.annotate_packs_batch(
            packs, ANNOTATION_MODEL, _ANNOTATION_PROMPT, PackedAnnotationResponse.model_json_schema()
        )

    annotations = _parse_pack_results(raw_results)
    _write_annotations(annotations, expected_ids)
    log.info("annotation complete: %d/%d items annotated", len(annotations), len(loaded))
