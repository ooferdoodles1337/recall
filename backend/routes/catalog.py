import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.catalog import db as catalog
from services.search import text_index

router = APIRouter()
_DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}(?:-\d{2})?$")


class _OrganizationPatch(BaseModel):
    favorite: bool | None = None


class _SafetyPatch(BaseModel):
    state: Literal["safe", "nsfw", "unknown"] | None = None


class _SearchPatch(BaseModel):
    phrases: list[str] | None = None


class CatalogItemPatch(BaseModel):
    organization: _OrganizationPatch | None = None
    safety: _SafetyPatch | None = None
    search: _SearchPatch | None = None


@router.get("/items")
def list_items(
    media_type: Annotated[Literal["image", "video"] | None, Query()] = None,
    favorite: Annotated[bool | None, Query()] = None,
    date_prefix: Annotated[str | None, Query()] = None,
    order: Annotated[Literal["asc", "desc"], Query()] = "desc",
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
):
    if date_prefix is not None and not _DATE_PREFIX_RE.fullmatch(date_prefix):
        raise HTTPException(status_code=400, detail="date_prefix must be YYYY-MM or YYYY-MM-DD")
    results = catalog.list_library_items(
        media_type=media_type,
        favorite=favorite,
        date_prefix=date_prefix,
        order=order,
        limit=limit,
    )
    return {"count": len(results), "results": results}


@router.get("/items/{id}")
def get_item(id: str):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.patch("/items/{id}")
def patch_item(id: str, body: CatalogItemPatch):
    item = catalog.get_item(id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        updated = catalog.patch_item(id, body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    text_index.rebuild()
    return updated


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
