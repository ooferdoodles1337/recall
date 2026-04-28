from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from services import chroma

router = APIRouter()


@router.get("/info")
def get_item_info(id: str = Query(..., description="File ID from search results")):
    item = chroma.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.get("/{file_path:path}")
def serve_media(file_path: str):
    if not file_path.startswith("data/media/"):
        raise HTTPException(status_code=403, detail="Access denied")
    p = Path(file_path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(p)
