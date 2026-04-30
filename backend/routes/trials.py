from fastapi import APIRouter, Query

from services import catalog

router = APIRouter()


@router.get("")
def get_trials(n: int = Query(5, ge=1, le=50, description="Number of trial targets")):
    ids = catalog.get_random_ids(n)
    targets = [catalog.get_item(item_id) for item_id in ids]
    return {"n": len(targets), "targets": targets}
