import os
import pytest


@pytest.fixture(autouse=True, scope="session")
def set_test_env():
    os.environ.setdefault("GEMINI_API_KEY", "test-key")


@pytest.fixture(autouse=True)
def clear_geocode_cache():
    """Ensure reverse_geocode LRU cache is cleared between tests."""
    from services.catalog.extractor import reverse_geocode_coords
    reverse_geocode_coords.cache_clear()
    yield
