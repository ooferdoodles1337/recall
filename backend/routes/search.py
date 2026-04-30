from fastapi import APIRouter, Query

from services import catalog, chroma, gemini, text_index

router = APIRouter()


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
            }
            for item in items
        ],
    }
