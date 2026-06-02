import logging
import time
from pathlib import Path
from typing import Any

import io

from PIL import Image

import config
from services.catalog import db as catalog
from services.catalog import schema as metadata_schema
from services.pipeline.media import HEIC_EXTENSIONS, _heic_to_jpeg_bytes

log = logging.getLogger(__name__)

MODEL_NAME = "hf_hub:Marqo/nsfw-image-detection-384"
NSFW_THRESHOLD = 0.9  # flag as NSFW only when model confidence >= this

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
    if path.suffix.lower() in HEIC_EXTENSIONS:
        raw = Image.open(io.BytesIO(_heic_to_jpeg_bytes(str(path))))
    else:
        raw = Image.open(path)
    with raw:
        image = raw.convert("RGB")
        tensor = transforms(image).unsqueeze(0)

    with torch.no_grad():
        probabilities = model(tensor).softmax(dim=-1).cpu()[0]

    scores = {
        class_name: float(probabilities[i])
        for i, class_name in enumerate(class_names)
    }
    nsfw_score = scores.get("NSFW", 0.0)
    return {
        "model": MODEL_NAME,
        "nsfw_score": nsfw_score,
        "state": "nsfw" if nsfw_score >= NSFW_THRESHOLD else "safe",
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

    log.info("running NSFW detection for %d items (threshold=%.2f)", len(undetected), NSFW_THRESHOLD)
    processed = 0
    nsfw_count = 0
    sfw_count = 0
    error_count = 0
    skip_count = 0

    for index, item in enumerate(undetected, start=1):
        if index == 1 or index % 25 == 0 or index == len(undetected):
            elapsed = time.monotonic() - started_at
            rate = processed / elapsed if elapsed > 0 else 0
            eta = (len(undetected) - index) / rate if rate > 0 else float("inf")
            log.info(
                "NSFW progress %d/%d: nsfw=%d sfw=%d errors=%d skipped=%d "
                "rate=%.1f/s eta=%.0fs elapsed=%.1fs",
                index, len(undetected),
                nsfw_count, sfw_count, error_count, skip_count,
                rate, eta, elapsed,
            )

        meta = item["metadata"] or {}
        path = _candidate_path(meta)
        if path is None:
            log.warning("item %s missing image path or thumbnail_path", item["id"])
            skip_count += 1
            continue
        if not path.is_file():
            log.warning("item %s NSFW candidate not found: %s", item["id"], path)
            skip_count += 1
            continue
        try:
            detection = detect_image(path)
            catalog.update_metadata(item["id"], metadata_schema.nsfw_patch(detection))
            processed += 1
            if detection["state"] == "nsfw":
                nsfw_count += 1
                log.info(
                    "NSFW flagged: id=%s score=%.4f file=%s",
                    item["id"], detection["nsfw_score"], path.name,
                )
            else:
                sfw_count += 1
                log.debug(
                    "SFW: id=%s nsfw_score=%.4f file=%s",
                    item["id"], detection["nsfw_score"], path.name,
                )
        except Exception as exc:
            error_count += 1
            log.error("failed NSFW detection for %s (%s): %s", item["id"], path.name if path else "?", exc)

    log.info(
        "NSFW detection complete: processed=%d nsfw=%d sfw=%d errors=%d skipped=%d elapsed=%.1fs",
        processed, nsfw_count, sfw_count, error_count, skip_count,
        time.monotonic() - started_at,
    )


def migrate_safety_schema() -> None:
    """Rewrite existing safety records that use the old schema (labels/provider/SFW score)
    to the simplified schema (nsfw_score, state, model, checked_at) without re-running
    the model. Safe to run while annotation is in progress."""
    all_items = catalog.get_all_items_with_metadata()
    to_migrate = [
        item for item in all_items
        if isinstance((item["metadata"] or {}).get("safety"), dict)
        and "labels" in (item["metadata"] or {})["safety"]
    ]
    if not to_migrate:
        log.info("safety schema migration: nothing to migrate")
        return

    log.info("safety schema migration: migrating %d items", len(to_migrate))
    migrated = 0
    errors = 0
    for item in to_migrate:
        safety = item["metadata"]["safety"]
        labels = safety.get("labels") or {}
        nsfw_score = labels.get("NSFW")
        if nsfw_score is None:
            log.warning("migration: item %s has no labels.NSFW, skipping", item["id"])
            errors += 1
            continue
        synthetic = {
            "model": safety.get("model", MODEL_NAME),
            "nsfw_score": float(nsfw_score),
            "state": "nsfw" if float(nsfw_score) >= NSFW_THRESHOLD else "safe",
        }
        try:
            catalog.replace_safety(item["id"], metadata_schema.safety_from_detection(synthetic))
            migrated += 1
        except Exception as exc:
            log.error("migration: failed to update item %s: %s", item["id"], exc)
            errors += 1

    log.info("safety schema migration complete: migrated=%d errors=%d", migrated, errors)
