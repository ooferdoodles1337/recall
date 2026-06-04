from fastapi import APIRouter, Query

from services.catalog import db as catalog

router = APIRouter()


@router.get("")
def trials(n: int = Query(5, ge=1)):
    ids = catalog.get_random_ids(n)
    summaries = catalog.get_item_summaries(ids)
    return {
        "n": n,
        "targets": [summaries[item_id] for item_id in ids if item_id in summaries],
    }
