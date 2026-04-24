from unittest.mock import MagicMock, patch


def test_extract_sanitizes_keys(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {"EXIF:Make": "Canon", "File:FileSize": 1024, "SourceFile": str(p)}
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert "EXIF_Make" in result
    assert "File_FileSize" in result
    assert ":" not in "".join(result.keys())


def test_extract_returns_chromadb_safe_types(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {
        "EXIF:Make": "Canon",
        "EXIF:FNumber": 2.8,
        "File:FileSize": 1024,
        "EXIF:Flash": True,
    }
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["EXIF_Make"] == "Canon"
    assert result["EXIF_FNumber"] == 2.8
    assert result["File_FileSize"] == 1024
    assert result["EXIF_Flash"] is True


def test_extract_filters_out_list_and_dict_values(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {
        "EXIF:Make": "Canon",
        "EXIF:GPSVersionID": [2, 3, 0, 0],
        "XMP:Subject": {"nested": "dict"},
    }
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert "EXIF_Make" in result
    assert "EXIF_GPSVersionID" not in result
    assert "XMP_Subject" not in result


def test_extract_returns_empty_dict_on_exiftool_error(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    with patch("exiftool.ExifToolHelper", side_effect=RuntimeError("not found")):
        from services.metadata import extract
        result = extract(str(p))
    assert result == {}


def test_extract_adds_geo_fields_when_gps_present(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {
        "EXIF:Make": "Canon",
        "Composite:GPSLatitude": 40.7128,
        "Composite:GPSLongitude": -74.0060,
    }
    mock_location = MagicMock()
    mock_location.raw = {
        "address": {
            "city": "New York City",
            "state": "New York",
            "country": "United States",
            "country_code": "us",
        }
    }
    with patch("exiftool.ExifToolHelper") as mock_cls, \
         patch("services.metadata.Nominatim") as mock_nominatim_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        mock_geocoder = MagicMock()
        mock_nominatim_cls.return_value = mock_geocoder
        mock_geocoder.reverse.return_value = mock_location
        from services.metadata import extract
        result = extract(str(p))
    assert result["geo_city"] == "New York City"
    assert result["geo_state"] == "New York"
    assert result["geo_country"] == "United States"
    assert result["geo_country_code"] == "US"


def test_extract_skips_geocoding_when_no_gps(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {"EXIF:Make": "Canon"}
    with patch("exiftool.ExifToolHelper") as mock_cls, \
         patch("services.metadata.Nominatim") as mock_nominatim_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    mock_nominatim_cls.assert_not_called()
    assert "geo_city" not in result
    assert "geo_country" not in result


def test_extract_uses_town_fallback_when_no_city(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {
        "Composite:GPSLatitude": 51.5074,
        "Composite:GPSLongitude": -0.1278,
    }
    mock_location = MagicMock()
    mock_location.raw = {
        "address": {
            "town": "Lambeth",
            "state": "England",
            "country": "United Kingdom",
            "country_code": "gb",
        }
    }
    with patch("exiftool.ExifToolHelper") as mock_cls, \
         patch("services.metadata.Nominatim") as mock_nominatim_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        mock_geocoder = MagicMock()
        mock_nominatim_cls.return_value = mock_geocoder
        mock_geocoder.reverse.return_value = mock_location
        from services.metadata import extract
        result = extract(str(p))
    assert result["geo_city"] == "Lambeth"
    assert result["geo_country_code"] == "GB"


def test_extract_returns_partial_result_when_geocoding_fails(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {
        "EXIF:Make": "Canon",
        "Composite:GPSLatitude": 40.7128,
        "Composite:GPSLongitude": -74.0060,
    }
    with patch("exiftool.ExifToolHelper") as mock_cls, \
         patch("services.metadata.Nominatim") as mock_nominatim_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from geopy.exc import GeocoderTimedOut
        mock_geocoder = MagicMock()
        mock_nominatim_cls.return_value = mock_geocoder
        mock_geocoder.reverse.side_effect = GeocoderTimedOut("timeout")
        from services.metadata import extract
        result = extract(str(p))
    assert result["EXIF_Make"] == "Canon"
    assert "geo_city" not in result
