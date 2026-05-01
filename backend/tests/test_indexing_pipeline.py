import io

from PIL import Image


def _write_jpeg(path, color):
    image = Image.new("RGB", (16, 12), color=color)
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    path.write_bytes(buf.getvalue())


def test_run_indexes_temp_images_into_catalog_and_chroma(tmp_path, monkeypatch):
    import config
    from services import catalog, chroma
    from services.indexer import run

    data_dir = tmp_path / "data"
    media_dir = data_dir / "media"
    thumbs_dir = data_dir / "thumbnails"
    chroma_path = data_dir / "databases" / "chroma_db"
    catalog_path = data_dir / "databases" / "catalog.sqlite"
    media_dir.mkdir(parents=True)
    thumbs_dir.mkdir(parents=True)
    _write_jpeg(media_dir / "red.jpg", (255, 0, 0))
    _write_jpeg(media_dir / "blue.jpg", (0, 0, 255))

    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    monkeypatch.setattr(config, "MEDIA_DIR", media_dir)
    monkeypatch.setattr(config, "THUMBS_DIR", thumbs_dir)
    monkeypatch.setattr(config, "CATALOG_DB_PATH", catalog_path)
    monkeypatch.setattr(
        "services.indexer.metadata_svc.extract",
        lambda path: {"taken_sort": "2024-03-18T10:00:00", "taken_date": "2024-03-18"},
    )
    monkeypatch.setattr(
        "services.indexer.gemini.embed_content_batch",
        lambda items: {file_id: [0.1] * 3072 for file_id, _, _ in items},
    )

    run(
        force=False,
        annotate=False,
        db_path=str(chroma_path),
        media_dir=str(media_dir),
        reset=True,
    )

    catalog.configure(str(catalog_path))
    library_items = catalog.list_library_items()
    assert len(library_items) == 2
    assert {item["metadata"]["asset"]["filename"] for item in library_items} == {"red.jpg", "blue.jpg"}
    assert all((data_dir / item["metadata"]["asset"]["paths"]["thumbnail"]).is_file() for item in library_items)

    chroma.configure(str(chroma_path))
    vector_results = chroma.search([0.1] * 3072, n_results=2)
    assert set(vector_results["ids"][0]) == {item["id"] for item in library_items}
