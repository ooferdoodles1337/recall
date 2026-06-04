from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import config
from services.catalog import db as catalog
from services.catalog import schema as metadata_schema

router = APIRouter()


def _data_file(path: str, missing_detail: str) -> Path:
    base = config.DATA_DIR.resolve()
    resolved = (config.DATA_DIR / path).resolve()
    if not resolved.is_relative_to(base):
        raise HTTPException(status_code=404, detail=missing_detail)
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail=missing_detail)
    return resolved


@router.get("/{id}/animated-thumbnail")
def serve_animated_thumbnail(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    anim_path = metadata_schema.animated_thumbnail_path(item["metadata"] or {})
    if not anim_path:
        raise HTTPException(status_code=404, detail="Animated thumbnail not available")
    p = _data_file(anim_path, "Animated thumbnail file not found on disk")
    return FileResponse(p, media_type="image/webp")


@router.get("/{id}/display")
def serve_display(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    display = metadata_schema.display_path(item["metadata"] or {})
    if not display:
        raise HTTPException(status_code=404, detail="Display rendition not available")
    p = _data_file(display, "Display rendition file not found on disk")
    return FileResponse(p, media_type="image/webp")


@router.get("/{id}/thumbnail")
def serve_thumbnail(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    thumbnail_path = metadata_schema.thumbnail_path(item["metadata"] or {})
    if not thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    p = _data_file(thumbnail_path, "Thumbnail file not found on disk")
    return FileResponse(p, media_type="image/webp")


@router.get("/{id}")
def serve_media(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    path = metadata_schema.asset_path(item["metadata"] or {})
    if not path:
        raise HTTPException(status_code=404, detail="Path missing from item metadata")
    p = _data_file(path, "File not found on disk")
    mime = metadata_schema.mime_type(item["metadata"] or {})
    return FileResponse(p, media_type=mime or None)
