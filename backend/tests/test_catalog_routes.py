import pytest
from fastapi import HTTPException


def _item(id, taken_sort=None, media_type="image"):
    return {
        "id": id,
        "metadata": {
            "asset": {"media_type": media_type},
            "capture": {
                "sort_key": taken_sort,
                "date": taken_sort[:10] if taken_sort else None,
            },
        },
    }


def test_list_items_returns_count_and_results(monkeypatch):
    from routes.catalog import list_items

    items = [_item("a", "2024-03-18T10:00:00"), _item("b", "2024-03-17T10:00:00")]
    monkeypatch.setattr("services.catalog.db.list_library_items", lambda media_type=None, favorite=None, order="desc", limit=None: items)

    body = list_items()

    assert body["count"] == 2
    assert [item["id"] for item in body["results"]] == ["a", "b"]


def test_list_items_passes_filters(monkeypatch):
    from routes.catalog import list_items

    calls = []

    def fake_list(media_type=None, favorite=None, order="desc", limit=None):
        calls.append((media_type, favorite, order, limit))
        return []

    monkeypatch.setattr("services.catalog.db.list_library_items", fake_list)

    list_items(media_type="video", favorite=True, order="asc", limit=25)

    assert calls == [("video", True, "asc", 25)]


def test_get_item_returns_item(monkeypatch):
    from routes.catalog import get_item

    item = _item("abc")
    monkeypatch.setattr("services.catalog.db.get_item", lambda id: item)

    result = get_item("abc")

    assert result["id"] == "abc"


def test_get_item_404_when_missing(monkeypatch):
    from routes.catalog import get_item

    monkeypatch.setattr("services.catalog.db.get_item", lambda id: None)

    with pytest.raises(HTTPException) as exc:
        get_item("missing")
    assert exc.value.status_code == 404


def test_get_items_batch_returns_found_and_missing(monkeypatch):
    from routes.catalog import BatchRequest, get_items_batch

    store = {"a": _item("a"), "b": _item("b")}
    monkeypatch.setattr("services.catalog.db.get_item_summary", lambda id: store.get(id))

    body = get_items_batch(BatchRequest(ids=["a", "b", "c"]))

    assert {item["id"] for item in body["results"]} == {"a", "b"}
    assert body["missing"] == ["c"]


def test_get_stats_delegates_to_catalog(monkeypatch):
    from routes.catalog import get_stats

    monkeypatch.setattr("services.catalog.db.get_stats", lambda: {"total": 42, "by_media_type": {}})

    result = get_stats()

    assert result["total"] == 42


def test_get_facets_delegates_to_catalog(monkeypatch):
    from routes.catalog import get_facets

    facets = {"media_type": {"image": 10}, "taken_year_month": {"2024-03": 5}}
    monkeypatch.setattr("services.catalog.db.get_facets", lambda: facets)

    result = get_facets()

    assert result["media_type"]["image"] == 10
    assert result["taken_year_month"]["2024-03"] == 5


def test_trials_returns_random_target_summaries(monkeypatch):
    from routes.trials import trials

    monkeypatch.setattr("services.catalog.db.get_random_ids", lambda n: ["a", "b"])
    monkeypatch.setattr("services.catalog.db.get_item_summary", lambda id: _item(id))

    result = trials(n=2)

    assert result["n"] == 2
    assert [item["id"] for item in result["targets"]] == ["a", "b"]
