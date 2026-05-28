from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.catalog import db as catalog

router = APIRouter()


@router.get("/items")
def list_items(
    media_type: Annotated[Literal["image", "video"] | None, Query()] = None,
    favorite: Annotated[bool | None, Query()] = None,
    order: Annotated[Literal["asc", "desc"], Query()] = "desc",
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
):
    results = catalog.list_library_items(media_type=media_type, favorite=favorite, order=order, limit=limit)
    return {"count": len(results), "results": results}


@router.get("/items/{id}")
def get_item(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


class BatchRequest(BaseModel):
    ids: list[str]


@router.post("/items/batch")
def get_items_batch(body: BatchRequest):
    results = [catalog.get_item_summary(item_id) for item_id in body.ids]
    return {
        "results": [item for item in results if item is not None],
        "missing": [id for id, item in zip(body.ids, results) if item is None],
    }


@router.get("/facets")
def get_facets():
    return catalog.get_facets()


@router.get("/stats")
def get_stats():
    return catalog.get_stats()
