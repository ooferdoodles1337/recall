from fastapi import APIRouter, Query

from services import chroma, gemini

router = APIRouter()


@router.get("")
def search(q: str = Query(..., description="Search query text"), n: int = Query(5, ge=1, le=50)):
    embedding = gemini.embed_text(q)
    results = chroma.search(embedding, n_results=n)
    return {
        "query": q,
        "results": [
            {
                "id": doc_id,
                "distance": dist,
                "metadata": meta,
            }
            for doc_id, dist, meta in zip(
                results["ids"][0],
                results["distances"][0],
                results["metadatas"][0],
            )
        ],
    }
