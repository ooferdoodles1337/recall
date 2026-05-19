import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, UploadFile

from services.catalog import db as catalog
from services.providers import gemini
from services.search import chroma, text_index
from services.pipeline import media

router = APIRouter()

_ACCEPTED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


@router.get("/semantic")
def search_semantic(q: str = Query(..., description="Search query text"), n: int = Query(5, ge=1)):
    embedding = gemini.embed_text(q)
    results = chroma.search(embedding, n_results=n)
    ids = results["ids"][0]
    distances = results["distances"][0]
    return {
        "query": q,
        "results": [
            {
                "id": doc_id,
                "distance": dist,
                "metadata": item["metadata"],
                "links": item.get("links", {}),
            }
            for doc_id, dist in zip(ids, distances)
            if (item := catalog.get_item(doc_id)) is not None
        ],
    }


@router.get("/suggest")
def suggest(
    q: str = Query(..., description="Partial search query for autocomplete"),
    n: int = Query(5, ge=1),
):
    suggestions = text_index.suggest(q, n)
    return {"suggestions": suggestions}


@router.get("/text")
def search_text(
    q: str = Query(..., description="Search query text"),
    n: int = Query(10, ge=1),
):
    matched_ids = text_index.search_by_term(q)
    if not matched_ids:
        return {"query": q, "results": []}

    items = [catalog.get_item(item_id) for item_id in matched_ids]
    items = [item for item in items if item is not None]
    items = items[:n]

    return {
        "query": q,
        "results": [
            {
                "id": item["id"],
                "distance": None,
                "metadata": item["metadata"],
                "links": item.get("links", {}),
            }
            for item in items
        ],
    }


@router.get("/similar/{id}")
def search_similar_by_id(id: str, n: int = Query(5, ge=1)):
    embedding = chroma.get_embedding(id)
    if embedding is None:
        raise HTTPException(status_code=404, detail="Item not found")
    results = chroma.search(embedding, n_results=n + 1)
    ids = results["ids"][0]
    distances = results["distances"][0]
    return {
        "query_id": id,
        "results": [
            {"id": doc_id, "distance": dist, "metadata": item["metadata"], "links": item.get("links", {})}
            for doc_id, dist in zip(ids, distances)
            if doc_id != id and (item := catalog.get_item(doc_id)) is not None
        ][:n],
    }


@router.post("/similar")
async def search_similar_upload(file: UploadFile, n: int = Query(5, ge=1)):
    if file.content_type not in _ACCEPTED_IMAGE_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported type '{file.content_type}'. Accepted: {', '.join(sorted(_ACCEPTED_IMAGE_MIMES))}",
        )
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

    ext = _MIME_TO_EXT.get(file.content_type, ".jpg")
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        processed = media.process_image(tmp_path)
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)

    embedding = gemini.embed_content(processed.data, processed.mime_type)
    results = chroma.search(embedding, n_results=n)
    ids = results["ids"][0]
    distances = results["distances"][0]
    return {
        "query_filename": file.filename,
        "results": [
            {"id": doc_id, "distance": dist, "metadata": item["metadata"], "links": item.get("links", {})}
            for doc_id, dist in zip(ids, distances)
            if (item := catalog.get_item(doc_id)) is not None
        ],
    }
