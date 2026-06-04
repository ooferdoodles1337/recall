"""Tests for search routes — covers the shared format_result helper and all four endpoints."""
import pytest
from unittest.mock import MagicMock, patch


def _make_item(item_id: str, description: str = "a photo") -> dict:
    return {
        "id": item_id,
        "metadata": {"search": {"description": description}},
        "links": {"media": f"/media/{item_id}", "thumbnail": f"/media/{item_id}/thumbnail"},
    }


@pytest.fixture
def catalog_with_items(tmp_path, monkeypatch):
    import services.catalog.db as catalog
    catalog.configure(str(tmp_path / "catalog.sqlite"))
    for i in range(3):
        catalog.upsert_item(
            f"item-{i}",
            f"media/photo{i}.jpg",
            f"photo{i}.jpg",
            "image/jpeg",
            "image",
            extra_metadata={"content_hash": f"hash-{i}"},
        )
    return catalog


class TestFormatResult:
    def test_includes_id_distance_metadata_links(self):
        from routes._search_result import format_result

        item = _make_item("abc")
        result = format_result(item, 0.42)

        assert result["id"] == "abc"
        assert result["distance"] == 0.42
        assert result["metadata"] == item["metadata"]
        assert result["links"] == item["links"]

    def test_none_distance_allowed(self):
        from routes._search_result import format_result

        result = format_result(_make_item("x"), None)
        assert result["distance"] is None

    def test_missing_links_defaults_to_empty(self):
        from routes._search_result import format_result

        item = {"id": "y", "metadata": {}}
        result = format_result(item, 0.0)
        assert result["links"] == {}


class TestTextSearch:
    def test_returns_matching_items(self, catalog_with_items, monkeypatch):
        monkeypatch.setattr("services.search.text_index._term_list", [("photo", "item-0")])
        monkeypatch.setattr("services.search.text_index._term_to_ids", {"photo": {"item-0"}})

        from routes.search import search_text

        result = search_text(q="photo", n=5)

        assert result["query"] == "photo"
        assert len(result["results"]) == 1
        assert result["results"][0]["id"] == "item-0"
        assert result["results"][0]["distance"] is None

    def test_empty_when_no_match(self, catalog_with_items, monkeypatch):
        monkeypatch.setattr("services.search.text_index._term_list", [])
        monkeypatch.setattr("services.search.text_index._term_to_ids", {})

        from routes.search import search_text

        result = search_text(q="nothing", n=5)
        assert result["results"] == []

    def test_search_by_term_exact_match_is_ordered_and_deterministic(self, monkeypatch):
        from services.search import text_index

        monkeypatch.setattr(text_index, "_term_to_ids", {"beach": {"z", "a", "m"}})

        result = text_index.search_by_term("beach")

        # A set gave arbitrary order; the result must be a stable, sorted list.
        assert result == ["a", "m", "z"]

    def test_search_by_term_dedupes_prefix_tier_across_terms(self, monkeypatch):
        from services.search import text_index

        monkeypatch.setattr(
            text_index, "_term_to_ids", {"beach": {"a", "b"}, "beaches": {"b", "c"}}
        )
        monkeypatch.setattr(
            text_index, "_term_list", [("beach", "a"), ("beach", "b"), ("beaches", "b"), ("beaches", "c")]
        )

        # "bea" matches neither term exactly, so it falls through to the prefix tier.
        result = text_index.search_by_term("bea")

        assert result == ["a", "b", "c"]


class TestSchemaVersionGate:
    def test_second_configure_skips_migrations(self, tmp_path, monkeypatch):
        """After configure() stamps schema_version, re-running configure() must not call migrations."""
        import sqlite3
        import services.catalog.db as catalog
        from services.catalog._db_migrations import _DB_SCHEMA_VERSION

        db_path = str(tmp_path / "test.sqlite")
        catalog.configure(db_path)

        migration_calls = []
        original_run = __import__(
            "services.catalog._db_migrations", fromlist=["run_migrations"]
        ).run_migrations

        def counting_run(conn, from_version):
            migration_calls.append(from_version)
            original_run(conn, from_version)

        monkeypatch.setattr("services.catalog.db.run_migrations", counting_run)

        catalog.configure(db_path)

        assert migration_calls == [], "Migrations should not run when schema_version is current"


class TestTrialsRoute:
    def test_returns_n_items(self, tmp_path, monkeypatch):
        import services.catalog.db as catalog
        catalog.configure(str(tmp_path / "catalog.sqlite"))
        for i in range(5):
            catalog.upsert_item(
                f"item-{i}", f"media/photo{i}.jpg", f"photo{i}.jpg",
                "image/jpeg", "image", extra_metadata={"content_hash": f"hash-{i}"},
            )

        from routes.trials import trials
        result = trials(n=3)

        assert result["n"] == 3
        assert len(result["targets"]) == 3

    def test_filters_missing_summaries(self, tmp_path, monkeypatch):
        import services.catalog.db as catalog
        catalog.configure(str(tmp_path / "catalog.sqlite"))

        monkeypatch.setattr("services.catalog.db.get_random_ids", lambda n: ["missing-id"])
        monkeypatch.setattr("services.catalog.db.get_item_summaries", lambda ids: {})

        from routes.trials import trials
        result = trials(n=1)

        assert result["targets"] == []


class TestIndexerUpsertHelper:
    def test_store_indexed_item_calls_chroma_and_catalog(self, monkeypatch):
        from dataclasses import dataclass
        from pathlib import Path

        chroma_calls = []
        catalog_calls = []
        monkeypatch.setattr("services.search.chroma.upsert_content", lambda **kw: chroma_calls.append(kw))
        monkeypatch.setattr(
            "services.catalog.db.upsert_item",
            lambda **kw: catalog_calls.append(kw),
        )

        from services.pipeline.indexer import _PendingItem, _store_indexed_item

        item = _PendingItem(
            file_id="test-id",
            content_hash="abc123",
            rel_path="media/photo.jpg",
            path=Path("/data/media/photo.jpg"),
            original_mime="image/jpeg",
            original_media_type="image",
            file_size=4,
            file_mtime_ns=123,
            processed_data=b"fake",
            processed_mime="image/jpeg",
            file_metadata={"content_hash": "abc123"},
        )

        _store_indexed_item(item, [0.1, 0.2, 0.3])

        assert len(chroma_calls) == 1
        assert chroma_calls[0]["file_id"] == "test-id"
        assert len(catalog_calls) == 1
        assert catalog_calls[0]["file_id"] == "test-id"
        assert catalog_calls[0]["mime_type"] == "image/jpeg"
