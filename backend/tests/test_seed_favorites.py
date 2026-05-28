import pytest

from scripts.seed_favorites import seed_favorites


@pytest.fixture
def catalog_db(tmp_path, monkeypatch):
    db_path = tmp_path / "catalog.sqlite"
    monkeypatch.setattr("services.catalog.db._db_path", db_path)
    import services.catalog.db as catalog

    catalog.configure(str(db_path))
    return catalog


def test_seed_favorites_selects_requested_count(catalog_db):
    for index in range(40):
        catalog_db.upsert_item(
            f"item-{index:02d}",
            f"media/item-{index:02d}.jpg",
            f"item-{index:02d}.jpg",
            "image/jpeg",
            "image",
            extra_metadata={"content_hash": f"hash-{index:02d}", "taken_sort": f"2024-03-{index + 1:02d}T10:00:00"},
        )

    first = seed_favorites(count=34, seed="test-seed", catalog_db_path=str(catalog_db._db_path))
    second = seed_favorites(count=34, seed="test-seed", catalog_db_path=str(catalog_db._db_path))

    favorite_items = catalog_db.list_library_items(favorite=True)

    assert first["selected"] == 34
    assert len(first["ids"]) == 34
    assert second["ids"] == first["ids"]
    assert len(favorite_items) == 34
    assert {item["id"] for item in favorite_items} == set(first["ids"])


def test_seed_favorites_caps_to_catalog_size(catalog_db):
    for index in range(3):
        catalog_db.upsert_item(
            f"small-{index}",
            f"media/small-{index}.jpg",
            f"small-{index}.jpg",
            "image/jpeg",
            "image",
            extra_metadata={"content_hash": f"small-hash-{index}"},
        )

    result = seed_favorites(count=34, seed="test-seed", catalog_db_path=str(catalog_db._db_path))

    assert result["selected"] == 3
    assert len(catalog_db.list_library_items(favorite=True)) == 3
