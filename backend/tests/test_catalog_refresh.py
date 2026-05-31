import io

import chromadb
import pytest
from PIL import Image


@pytest.fixture
def refresh_catalog_db(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    media_dir = data_dir / "media"
    thumbs_dir = data_dir / "thumbnails"
    media_dir.mkdir(parents=True)
    thumbs_dir.mkdir(parents=True)

    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color=(255, 0, 0)).save(buf, format="JPEG")
    (media_dir / "photo.jpg").write_bytes(buf.getvalue())

    monkeypatch.setattr("config.DATA_DIR", data_dir)
    monkeypatch.setattr("config.MEDIA_DIR", media_dir)
    monkeypatch.setattr("config.THUMBS_DIR", thumbs_dir)
    monkeypatch.setattr("config.CATALOG_DB_PATH", data_dir / "databases" / "catalog.sqlite")

    ephemeral = chromadb.EphemeralClient()
    content_col = ephemeral.get_or_create_collection("media_content")
    monkeypatch.setattr("services.search.chroma.content_collection", content_col)

    import services.catalog.db as catalog

    catalog.configure(str(data_dir / "databases" / "catalog.sqlite"))
    catalog.reset()
    return {"catalog": catalog, "data_dir": data_dir}


def test_refresh_catalog_rebuilds_metadata_without_gemini(refresh_catalog_db, monkeypatch):
    catalog = refresh_catalog_db["catalog"]
    catalog.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={
            "content_hash": "hash-1",
            "thumbnail_path": "thumbnails/item-1.webp",
            "EXIF_Make": "Old",
        },
    )
    catalog.update_metadata(
        "item-1",
        {
            "search": {
                "description": "a saved annotation",
                "phrases": ["saved"],
                "annotation": {"provider": "gemini", "model": "expensive-model"},
            },
            "organization": {"favorite": True, "folders": ["keepers"]},
            "safety": {"state": "safe", "score": 0.99},
        },
    )

    def fail_gemini(*args, **kwargs):
        raise AssertionError("Gemini should not be called during catalog refresh")

    monkeypatch.setattr("services.providers.gemini.embed_content", fail_gemini)
    monkeypatch.setattr("services.providers.gemini.embed_content_batch", fail_gemini)
    monkeypatch.setattr("services.providers.gemini_annotation.annotate_pack", fail_gemini)
    monkeypatch.setattr("services.catalog.refresh.metadata_svc.extract", lambda path, **kwargs: {"EXIF_Make": "New"})

    from services.catalog.refresh import refresh_catalog

    stats = refresh_catalog(extract=True)

    item = catalog.get_item("item-1")
    assert stats["updated"] == 1
    assert item["metadata"]["raw"]["exif"]["EXIF_Make"] == "New"
    assert item["metadata"]["search"]["description"] == "a saved annotation"
    assert item["metadata"]["search"]["annotation"]["model"] == "expensive-model"
    assert item["metadata"]["organization"]["favorite"] is True
    assert item["metadata"]["safety"]["state"] == "safe"
    assert item["metadata"]["system"]["embedding"]["model"] == "gemini-embedding-2"


def test_refresh_catalog_dry_run_does_not_write(refresh_catalog_db, monkeypatch):
    catalog = refresh_catalog_db["catalog"]
    catalog.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={"content_hash": "hash-1", "EXIF_Make": "Old"},
    )
    monkeypatch.setattr("services.catalog.refresh.metadata_svc.extract", lambda path, **kwargs: {"EXIF_Make": "New"})

    from services.catalog.refresh import refresh_catalog

    stats = refresh_catalog(extract=True, dry_run=True)

    item = catalog.get_item("item-1")
    assert stats["updated"] == 1
    assert item["metadata"]["raw"]["exif"]["EXIF_Make"] == "Old"


def test_refresh_catalog_backfills_embedding_mime_type(refresh_catalog_db):
    catalog = refresh_catalog_db["catalog"]
    data_dir = refresh_catalog_db["data_dir"]
    webp_path = data_dir / "media" / "photo.webp"
    Image.new("RGB", (16, 16), color=(0, 255, 0)).save(webp_path, format="WEBP")
    catalog.upsert_item(
        "item-1",
        "media/photo.webp",
        "photo.webp",
        "image/webp",
        "image",
        extra_metadata={"content_hash": "hash-1"},
    )

    from services.catalog.refresh import refresh_catalog

    stats = refresh_catalog()

    item = catalog.get_item("item-1")
    assert stats["updated"] == 1
    assert item["metadata"]["asset"]["mime_type"] == "image/webp"
    assert item["metadata"]["asset"]["embedding_mime_type"] == "image/jpeg"


def test_refresh_catalog_reverse_geocodes_existing_gps_without_extraction(refresh_catalog_db, monkeypatch):
    catalog = refresh_catalog_db["catalog"]
    catalog.upsert_item(
        "item-1",
        "media/photo.jpg",
        "photo.jpg",
        "image/jpeg",
        "image",
        extra_metadata={
            "content_hash": "hash-1",
            "EXIF_Make": "Old",
            "Composite_GPSLatitude": 48.8566,
            "Composite_GPSLongitude": 2.3522,
        },
    )

    def fail_extract(*args, **kwargs):
        raise AssertionError("ExifTool extraction should not run")

    monkeypatch.setattr("services.catalog.refresh.metadata_svc.extract", fail_extract)
    monkeypatch.setattr(
        "services.catalog.refresh.metadata_svc.reverse_geocode_coords",
        lambda lat, lon: {
            "geo_city": "Paris",
            "geo_country": "France",
            "geo_country_code": "FR",
        },
    )

    from services.catalog.refresh import refresh_catalog

    stats = refresh_catalog(reverse_geocode=True)

    full = catalog.get_item("item-1")
    summary = catalog.get_item_summary("item-1")
    assert stats["updated"] == 1
    assert stats["geocoded"] == 1
    assert full["metadata"]["raw"]["exif"]["EXIF_Make"] == "Old"
    assert full["metadata"]["capture"]["location"]["city"] == "Paris"
    assert summary["metadata"]["capture"]["location"]["country_code"] == "FR"
