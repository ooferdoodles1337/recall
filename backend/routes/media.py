from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import config
from services.catalog import db as catalog
from services.catalog import schema as metadata_schema

router = APIRouter()


@router.get("/{id}/thumbnail")
def serve_thumbnail(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    thumbnail_path = metadata_schema.thumbnail_path(item["metadata"] or {})
    if not thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    p = config.DATA_DIR / thumbnail_path
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Thumbnail file not found on disk")
    return FileResponse(p, media_type="image/webp")


@router.get("/{id}")
def serve_media(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    path = metadata_schema.asset_path(item["metadata"] or {})
    if not path:
        raise HTTPException(status_code=404, detail="Path missing from item metadata")
    p = config.DATA_DIR / path
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")
    mime = metadata_schema.mime_type(item["metadata"] or {})
    return FileResponse(p, media_type=mime or None)
