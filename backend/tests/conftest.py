import os
import pytest


@pytest.fixture(autouse=True, scope="session")
def set_test_env():
    os.environ.setdefault("GEMINI_API_KEY", "test-key")


@pytest.fixture(autouse=True)
def clear_geocode_cache():
    """Ensure _reverse_geocode LRU cache is cleared between tests."""
    from services.catalog.extractor import _reverse_geocode
    _reverse_geocode.cache_clear()
    yield
