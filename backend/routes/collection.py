from fastapi import APIRouter

from services import chroma

router = APIRouter()


@router.get("/stats")
def get_stats():
    return chroma.get_stats()
