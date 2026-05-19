import logging
import time
from pathlib import Path
from typing import Any

from PIL import Image

import config
from services.catalog import db as catalog
from services.catalog import schema as metadata_schema

log = logging.getLogger(__name__)

MODEL_NAME = "hf_hub:Marqo/nsfw-image-detection-384"

_model: Any | None = None
_transforms: Any | None = None
_class_names: list[str] | None = None


def _load_model() -> tuple[Any, Any, list[str]]:
    global _model, _transforms, _class_names
    if _model is None or _transforms is None or _class_names is None:
        try:
            import timm
            import timm.data
        except ImportError as exc:
            raise RuntimeError(
                "NSFW detection requires indexing dependencies. "
                "Install them with `uv sync --group indexing`."
            ) from exc

        _model = timm.create_model(MODEL_NAME, pretrained=True).eval()
        data_config = timm.data.resolve_model_data_config(_model)
        _transforms = timm.data.create_transform(**data_config, is_training=False)
        _class_names = list(_model.pretrained_cfg["label_names"])
    return _model, _transforms, _class_names


def _candidate_path(meta: dict) -> Path | None:
    path = metadata_schema.asset_path(meta)
    if metadata_schema.media_type(meta) == "image" and path:
        return config.DATA_DIR / path

    thumbnail_path = metadata_schema.thumbnail_path(meta)
    if thumbnail_path:
        return config.DATA_DIR / thumbnail_path

    return None


def detect_image(path: Path) -> dict:
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError(
            "NSFW detection requires indexing dependencies. "
            "Install them with `uv sync --group indexing`."
        ) from exc

    model, transforms, class_names = _load_model()
    with Image.open(path) as raw:
        image = raw.convert("RGB")
        tensor = transforms(image).unsqueeze(0)

    with torch.no_grad():
        probabilities = model(tensor).softmax(dim=-1).cpu()[0]

    scores = {
        class_name: float(probabilities[i])
        for i, class_name in enumerate(class_names)
    }
    label = max(scores, key=scores.get)
    return {
        "model": MODEL_NAME,
        "label": label,
        "score": scores[label],
        "probabilities": scores,
    }


def _get_undetected() -> list[dict]:
    all_items = catalog.get_all_items_with_metadata()
    return [item for item in all_items if not metadata_schema.has_safety_detection(item["metadata"] or {})]


def detect_undetected() -> None:
    started_at = time.monotonic()
    undetected = _get_undetected()
    if not undetected:
        log.info("all items already have NSFW detection")
        return

    log.info("running NSFW detection for %d items", len(undetected))
    detected = 0
    for index, item in enumerate(undetected, start=1):
        if index == 1 or index % 50 == 0 or index == len(undetected):
            log.info(
                "NSFW progress %d/%d: detected=%d elapsed=%.1fs",
                index,
                len(undetected),
                detected,
                time.monotonic() - started_at,
            )
        meta = item["metadata"] or {}
        path = _candidate_path(meta)
        if path is None:
            log.warning("item %s missing image path or thumbnail_path", item["id"])
            continue
        if not path.is_file():
            log.warning("item %s NSFW candidate not found: %s", item["id"], path)
            continue
        try:
            detection = detect_image(path)
            catalog.update_metadata(item["id"], metadata_schema.nsfw_patch(detection))
            detected += 1
            log.debug(
                "NSFW detected: id=%s path=%s label=%s score=%.4f",
                item["id"],
                path,
                detection["label"],
                detection["score"],
            )
        except Exception as exc:
            log.error("failed NSFW detection for %s: %s", item["id"], exc)

    log.info("NSFW detection complete: %d/%d items detected, elapsed=%.1fs", detected, len(undetected), time.monotonic() - started_at)
