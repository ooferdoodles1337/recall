from typing import Any

from pydantic import BaseModel


class SearchResultItem(BaseModel):
    id: str
    distance: float | None
    metadata: dict[str, Any]
    links: dict[str, str]

    model_config = {"arbitrary_types_allowed": True}


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]


class SimilarByIdResponse(BaseModel):
    query_id: str
    results: list[SearchResultItem]


class SimilarUploadResponse(BaseModel):
    query_filename: str | None
    results: list[SearchResultItem]


def format_result(item: dict, distance: float | None) -> dict[str, Any]:
    return {
        "id": item["id"],
        "distance": distance,
        "metadata": item["metadata"],
        "links": item.get("links", {}),
    }
