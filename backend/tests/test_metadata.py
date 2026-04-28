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
         patch("services.metadata._geocoder") as mock_geocoder:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
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
         patch("services.metadata._geocoder") as mock_geocoder:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    mock_geocoder.reverse.assert_not_called()
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
         patch("services.metadata._geocoder") as mock_geocoder:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
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
         patch("services.metadata._geocoder") as mock_geocoder:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from geopy.exc import GeocoderTimedOut
        mock_geocoder.reverse.side_effect = GeocoderTimedOut("timeout")
        from services.metadata import extract
        result = extract(str(p))
    assert result["EXIF_Make"] == "Canon"
    assert "geo_city" not in result


def test_extract_normalizes_width_height_from_exif(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {"EXIF:ImageWidth": 1920, "EXIF:ImageHeight": 1080}
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["width"] == 1920
    assert result["height"] == 1080


def test_extract_prefers_composite_over_exif_dimensions(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {
        "Composite:ImageWidth": 3840,
        "Composite:ImageHeight": 2160,
        "EXIF:ImageWidth": 1920,
        "EXIF:ImageHeight": 1080,
    }
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["width"] == 3840
    assert result["height"] == 2160


def test_extract_normalizes_width_height_from_file_fallback(tmp_path):
    p = tmp_path / "video.mp4"
    p.write_bytes(b"fake")
    raw = {"File:ImageWidth": 1280, "File:ImageHeight": 720}
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["width"] == 1280
    assert result["height"] == 720


def test_extract_normalizes_width_height_from_generic_image_tags(tmp_path):
    p = tmp_path / "photo.png"
    p.write_bytes(b"fake")
    raw = {"ImageWidth": 800, "ImageHeight": 600}
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["width"] == 800
    assert result["height"] == 600


def test_extract_normalizes_duration_from_quicktime(tmp_path):
    p = tmp_path / "movie.mov"
    p.write_bytes(b"fake")
    raw = {"QuickTime:Duration": 62.5}
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["duration_s"] == 62.5


def test_extract_parses_duration_time_string(tmp_path):
    p = tmp_path / "clip.avi"
    p.write_bytes(b"fake")
    raw = {"RIFF:Duration": "0:01:23.500"}
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["duration_s"] == 83.5


def test_extract_prefers_composite_duration(tmp_path):
    p = tmp_path / "movie.mov"
    p.write_bytes(b"fake")
    raw = {
        "Composite:Duration": 120.0,
        "QuickTime:Duration": 60.0,
        "Track:Duration": 58.5,
    }
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["duration_s"] == 120.0


def test_extract_prefers_longest_duration_when_no_composite(tmp_path):
    p = tmp_path / "movie.mov"
    p.write_bytes(b"fake")
    raw = {
        "Track:Duration": 58.5,
        "Movie:Duration": 120.0,
        "QuickTime:Duration": 60.0,
    }
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["duration_s"] == 120.0


def test_extract_parses_xmp_duration(tmp_path):
    p = tmp_path / "media.mp4"
    p.write_bytes(b"fake")
    raw = {
        "XMP:DurationScale": 0.001,
        "XMP:DurationValue": 90500,
    }
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert result["duration_s"] == 90.5


def test_extract_skips_normalization_when_dimensions_absent(tmp_path):
    p = tmp_path / "photo.jpg"
    p.write_bytes(b"fake")
    raw = {"EXIF:Make": "Canon"}
    with patch("exiftool.ExifToolHelper") as mock_cls:
        inst = MagicMock()
        mock_cls.return_value.__enter__.return_value = inst
        mock_cls.return_value.__exit__.return_value = False
        inst.get_metadata.return_value = [raw]
        from services.metadata import extract
        result = extract(str(p))
    assert "width" not in result
    assert "height" not in result
    assert "duration_s" not in result
