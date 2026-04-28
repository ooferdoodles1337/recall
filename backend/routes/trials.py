from fastapi import APIRouter, Query

from services import chroma

router = APIRouter()


@router.get("")
def get_trials(n: int = Query(5, ge=1, le=50, description="Number of trial targets")):
    ids = chroma.get_random_ids(n)
    targets = [chroma.get_item(item_id) for item_id in ids]
    return {"n": len(targets), "targets": targets}
