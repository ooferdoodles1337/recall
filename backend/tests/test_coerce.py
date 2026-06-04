import pytest
from services.utils.coerce import as_int, as_float


class TestAsInt:
    def test_int_passes_through(self):
        assert as_int(42) == 42

    def test_float_truncates(self):
        assert as_int(3.9) == 3

    def test_bool_returns_none(self):
        assert as_int(True) is None
        assert as_int(False) is None

    def test_none_returns_none(self):
        assert as_int(None) is None

    def test_numeric_string_parses(self):
        assert as_int("5") == 5

    def test_float_string_truncates(self):
        assert as_int("3.9") == 3

    def test_non_numeric_string_returns_none(self):
        assert as_int("abc") is None


class TestAsFloat:
    def test_float_passes_through(self):
        assert as_float(1.5) == 1.5

    def test_int_becomes_float(self):
        assert as_float(3) == 3.0

    def test_bool_returns_none(self):
        assert as_float(True) is None
        assert as_float(False) is None

    def test_none_returns_none(self):
        assert as_float(None) is None

    def test_numeric_string_parses(self):
        assert as_float("3.14") == pytest.approx(3.14)

    def test_non_numeric_string_returns_none(self):
        assert as_float("abc") is None

    def test_whitespace_string_parses(self):
        assert as_float("  2.0  ") == 2.0
