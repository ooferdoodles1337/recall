from pathlib import Path

import pytest


@pytest.fixture
def catalog_db(tmp_path, monkeypatch):
    db_path = tmp_path / "catalog.sqlite"
    monkeypatch.setattr("services.catalog._db_path", db_path)
    import services.catalog as catalog
    catalog.configure(str(db_path))
    return catalog


def test_upsert_and_get_item_round_trips_metadata(catalog_db):
    catalog_db.upsert_item(
        file_id="item-1",
        path="media/photo.jpg",
        filename="photo.jpg",
        mime_type="image/jpeg",
        media_type="image",
        extra_metadata={
            "content_hash": "hash-1",
            "taken_sort": "2024-03-18T10:00:00",
            "taken_date": "2024-03-18",
            "taken_year_month": "2024-03",
            "duration_s": 1.5,
            "width": 640,
            "height": 480,
            "geo_city": "Paris",
            "geo_country": "France",
            "EXIF_Make": "Nikon",
            "Composite_GPSLatitude": 48.8566,
        },
    )

    item = catalog_db.get_item("item-1")

    assert item["id"] == "item-1"
    assert item["links"] == {"media": "/media/item-1"}
    assert item["metadata"]["asset"]["filename"] == "photo.jpg"
    assert item["metadata"]["asset"]["mime_type"] == "image/jpeg"
    assert item["metadata"]["asset"]["media_type"] == "image"
    assert item["metadata"]["asset"]["paths"]["original"] == "media/photo.jpg"
    assert item["metadata"]["capture"]["sort_key"] == "2024-03-18T10:00:00"
    assert item["metadata"]["capture"]["date"] == "2024-03-18"
    assert item["metadata"]["capture"]["location"]["city"] == "Paris"
    assert item["metadata"]["system"]["content_hash"] == "hash-1"
    assert item["metadata"]["system"]["schema_version"] == 2
    assert item["metadata"]["raw"]["exif"] == {
        "EXIF_Make": "Nikon",
        "Composite_GPSLatitude": 48.8566,
    }


def test_get_id_by_hash_uses_catalog_content_hash(catalog_db):
    catalog_db.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-1"},
    )

    assert catalog_db.get_id_by_hash("hash-1") == "item-1"
    assert catalog_db.get_id_by_hash("missing") is None


def test_list_library_items_filters_and_sorts(catalog_db):
    catalog_db.upsert_item(
        "older",
        "media/older.jpg",
        "older.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-older", "taken_sort": "2024-03-17T10:00:00"},
    )
    catalog_db.upsert_item(
        "newer",
        "media/newer.jpg",
        "newer.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-newer", "taken_sort": "2024-03-18T10:00:00"},
    )
    catalog_db.upsert_item(
        "video",
        "media/video.mp4",
        "video.mp4",
        "video/mp4",
        "video",
        extra_metadata={"content_hash": "hash-video", "taken_sort": "2024-03-19T10:00:00"},
    )

    items = catalog_db.list_library_items(media_type="image", order="desc")

    assert [item["id"] for item in items] == ["newer", "older"]


def test_update_metadata_merges_patch(catalog_db):
    catalog_db.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-1", "search_terms": ["old"]},
    )

    catalog_db.update_metadata("item-1", {"search": {"description": "a photo", "phrases": ["new"]}})

    item = catalog_db.get_item("item-1")
    assert item["metadata"]["asset"]["filename"] == "photo.jpg"
    assert item["metadata"]["search"]["description"] == "a photo"
    assert item["metadata"]["search"]["phrases"] == ["new"]


def test_reset_deletes_catalog_data(catalog_db):
    catalog_db.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-1"},
    )

    catalog_db.reset()

    assert catalog_db.get_item("item-1") is None


def test_configure_creates_parent_directory(tmp_path):
    import services.catalog as catalog

    db_path = tmp_path / "nested" / "catalog.sqlite"
    catalog.configure(str(db_path))

    assert Path(db_path).is_file()
