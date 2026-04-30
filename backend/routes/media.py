from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import config
from services import catalog

router = APIRouter()


@router.get("/{id}/thumbnail")
def serve_thumbnail(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    thumbnail_path = (item["metadata"] or {}).get("thumbnail_path")
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
    path = (item["metadata"] or {}).get("path")
    if not path:
        raise HTTPException(status_code=404, detail="Path missing from item metadata")
    p = config.DATA_DIR / path
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(p)
