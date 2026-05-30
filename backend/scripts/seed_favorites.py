from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.catalog import db as catalog

DEFAULT_COUNT = 34
DEFAULT_SEED = "recall-favorites-v1"


def _is_favorite(item: dict) -> bool:
    metadata = item.get("metadata")
    organization = metadata.get("organization") if isinstance(metadata, dict) else None
    return isinstance(organization, dict) and organization.get("favorite") is True


def seed_favorites(
    *,
    count: int = DEFAULT_COUNT,
    seed: str = DEFAULT_SEED,
    catalog_db_path: str | None = None,
) -> dict[str, object]:
    if count < 0:
        raise ValueError("count must be non-negative")

    catalog.configure(catalog_db_path)
    items = catalog.get_all_items_with_metadata()
    ids = sorted(item["id"] for item in items)

    cleared = 0
    for item in items:
        if _is_favorite(item):
            catalog.update_metadata(item["id"], {"organization": {"favorite": False}})
            cleared += 1

    selected_ids = random.Random(seed).sample(ids, min(count, len(ids)))
    for item_id in selected_ids:
        catalog.update_metadata(item_id, {"organization": {"favorite": True}})

    return {
        "total": len(ids),
        "requested": count,
        "selected": len(selected_ids),
        "cleared": cleared,
        "ids": selected_ids,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed deterministic demo favorites into the Recall catalog")
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help=f"Number of favorites to seed (default: {DEFAULT_COUNT})")
    parser.add_argument("--seed", default=DEFAULT_SEED, help=f"Deterministic random seed (default: {DEFAULT_SEED})")
    parser.add_argument("--catalog-db-path", default=None, help="Catalog SQLite path (default: backend/data/databases/catalog.sqlite)")
    args = parser.parse_args()

    result = seed_favorites(count=args.count, seed=args.seed, catalog_db_path=args.catalog_db_path)
    print(
        f"Seeded {result['selected']} favorites "
        f"from {result['total']} catalog items "
        f"(cleared {result['cleared']})."
    )


if __name__ == "__main__":
    main()
