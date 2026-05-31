from fastapi import APIRouter, Query

from services.catalog import db as catalog

router = APIRouter()


@router.get("")
def trials(n: int = Query(5, ge=1)):
    targets = [catalog.get_item_summary(item_id) for item_id in catalog.get_random_ids(n)]
    return {
        "n": n,
        "targets": [target for target in targets if target is not None],
    }
