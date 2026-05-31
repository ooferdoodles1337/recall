import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, UploadFile

import config
from routes._search_result import (
    format_result,
    SearchResponse,
    SimilarByIdResponse,
    SimilarUploadResponse,
)
from services.catalog import db as catalog
from services.providers import gemini
from services.search import chroma, text_index

router = APIRouter()

_ACCEPTED_IMAGE_MIMES = config.ACCEPTED_UPLOAD_MIMES
_MIME_TO_EXT = config.MIME_TO_EXT
_MAX_UPLOAD_BYTES = config.MAX_UPLOAD_BYTES


@router.get("/semantic", response_model=SearchResponse)
def search_semantic(q: str = Query(..., description="Search query text"), n: int = Query(5, ge=1)):
    embedding = gemini.embed_text(q)
    results = chroma.search(embedding, n_results=n)
    ids = results["ids"][0]
    distances = results["distances"][0]
    return {
        "query": q,
        "results": [
            format_result(item, dist)
            for doc_id, dist in zip(ids, distances)
            if (item := catalog.get_item_summary(doc_id)) is not None
        ],
    }


@router.get("/suggest")
def suggest(
    q: str = Query(..., description="Partial search query for autocomplete"),
    n: int = Query(5, ge=1),
):
    suggestions = text_index.suggest(q, n)
    return {"suggestions": suggestions}


@router.get("/text", response_model=SearchResponse)
def search_text(
    q: str = Query(..., description="Search query text"),
    n: int = Query(10, ge=1),
):
    matched_ids = text_index.search_by_term(q)
    if not matched_ids:
        return {"query": q, "results": []}

    items = [catalog.get_item_summary(item_id) for item_id in matched_ids]
    items = [item for item in items if item is not None]
    items = items[:n]

    return {
        "query": q,
        "results": [format_result(item, None) for item in items],
    }


@router.get("/similar/{id}", response_model=SimilarByIdResponse)
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
            format_result(item, dist)
            for doc_id, dist in zip(ids, distances)
            if doc_id != id and (item := catalog.get_item_summary(doc_id)) is not None
        ][:n],
    }


@router.post("/similar", response_model=SimilarUploadResponse)
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
        from services.pipeline.media import process_image

        processed = process_image(tmp_path)
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)

    embedding = gemini.embed_content(processed.data, processed.embedding_mime)
    results = chroma.search(embedding, n_results=n)
    ids = results["ids"][0]
    distances = results["distances"][0]
    return {
        "query_filename": file.filename,
        "results": [
            format_result(item, dist)
            for doc_id, dist in zip(ids, distances)
            if (item := catalog.get_item_summary(doc_id)) is not None
        ],
    }
