import json
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def catalog_db(tmp_path, monkeypatch):
    db_path = tmp_path / "catalog.sqlite"
    monkeypatch.setattr("services.catalog.db._db_path", db_path)
    import services.catalog.db as catalog
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
    assert "raw" not in items[0]["metadata"]
    assert "system" not in items[0]["metadata"]


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

    summary = catalog_db.get_item_summary("item-1")
    assert summary["metadata"]["search"]["description"] == "a photo"
    assert summary["metadata"]["search"]["phrases"] == ["new"]
    assert "raw" not in summary["metadata"]


def test_promoted_safety_score_uses_nsfw_label(catalog_db):
    catalog_db.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-1"},
    )

    catalog_db.update_metadata("item-1", {
        "safety": {
            "state": "safe",
            "score": 0.85,
            "labels": {"NSFW": 0.15, "SFW": 0.85},
            "model": "test-model",
        },
    })

    with sqlite3.connect(catalog_db._db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT safety_score FROM media_items WHERE id = ?", ("item-1",)).fetchone()

    assert row["safety_score"] == 0.15
    assert catalog_db.get_item_summary("item-1")["metadata"]["safety"]["score"] == 0.15


def test_replace_metadata_rewrites_full_document(catalog_db):
    catalog_db.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-1", "EXIF_Make": "Old"},
    )
    original = catalog_db.get_item("item-1")["metadata"]

    from services.catalog import schema as metadata_schema

    replacement = metadata_schema.rebuild_metadata(
        path="media/photo.jpg",
        filename="photo.jpg",
        mime_type="image/jpeg",
        media_type="image",
        existing_metadata=original,
        extracted_metadata={"EXIF_Model": "New"},
    )

    catalog_db.replace_metadata("item-1", replacement)

    item = catalog_db.get_item("item-1")
    assert "EXIF_Make" not in item["metadata"]["raw"]["exif"]
    assert item["metadata"]["raw"]["exif"]["EXIF_Model"] == "New"


def test_configure_migrates_legacy_catalog_columns(tmp_path):
    import services.catalog.db as catalog
    from services.catalog import schema as metadata_schema

    db_path = tmp_path / "catalog.sqlite"
    metadata = metadata_schema.build_metadata(
        path="media/photo.jpg",
        filename="photo.jpg",
        mime_type="image/jpeg",
        media_type="image",
        extra_metadata={
            "content_hash": "hash-1",
            "thumbnail_path": "thumbnails/item-1.webp",
            "taken_sort": "2024-03-18T10:00:00",
            "taken_date": "2024-03-18",
            "taken_year_month": "2024-03",
            "geo_city": "Paris",
            "geo_country": "France",
            "Composite_GPSLatitude": 48.8566,
            "Composite_GPSLongitude": 2.3522,
            "search_terms": ["eiffel tower"],
            "EXIF_Make": "Nikon",
        },
    )
    metadata = metadata_schema.merge_metadata(
        metadata,
        {
            "search": {
                "description": "a Paris photo",
                "annotation": {"provider": "gemini", "model": "test-model", "updated_at": "2026-05-20T00:00:00Z"},
            },
            "organization": {"favorite": True, "folders": ["travel"]},
            "safety": {"state": "safe", "score": 0.99},
        },
    )

    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            CREATE TABLE media_items (
                id TEXT PRIMARY KEY,
                media_type TEXT NOT NULL,
                content_hash TEXT NOT NULL UNIQUE,
                taken_sort TEXT,
                taken_year_month TEXT,
                metadata_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute(
            """
            INSERT INTO media_items (id, media_type, content_hash, taken_sort, taken_year_month, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "item-1",
                "image",
                "hash-1",
                "2024-03-18T10:00:00",
                "2024-03",
                json.dumps(metadata, sort_keys=True),
            ),
        )

    catalog.configure(str(db_path))

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(media_items)").fetchall()}
        row = conn.execute(
            """
            SELECT filename, asset_path, thumbnail_path, search_description, has_annotation,
                   geo_city, geo_country, favorite, folders_json, safety_state, safety_score
            FROM media_items WHERE id = ?
            """,
            ("item-1",),
        ).fetchone()

    assert {"filename", "asset_path", "search_description", "geo_city", "favorite"} <= columns
    assert row["filename"] == "photo.jpg"
    assert row["asset_path"] == "media/photo.jpg"
    assert row["thumbnail_path"] == "thumbnails/item-1.webp"
    assert row["search_description"] == "a Paris photo"
    assert row["has_annotation"] == 1
    assert row["geo_city"] == "Paris"
    assert row["geo_country"] == "France"
    assert row["favorite"] == 1
    assert json.loads(row["folders_json"]) == ["travel"]
    assert row["safety_state"] == "safe"
    assert row["safety_score"] == 0.99

    full = catalog.get_item("item-1")
    summary = catalog.get_item_summary("item-1")
    assert full["metadata"]["raw"]["exif"]["EXIF_Make"] == "Nikon"
    assert "raw" not in summary["metadata"]
    assert summary["metadata"]["capture"]["location"]["city"] == "Paris"
    assert summary["metadata"]["organization"]["favorite"] is True


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
    import services.catalog.db as catalog

    db_path = tmp_path / "nested" / "catalog.sqlite"
    catalog.configure(str(db_path))

    assert Path(db_path).is_file()
