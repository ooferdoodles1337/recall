from fastapi import APIRouter

from services import catalog

router = APIRouter()


@router.get("/stats")
def get_stats():
    return catalog.get_stats()
