def test_tester_route_returns_html():
    from main import TESTER_PAGE

    assert TESTER_PAGE.is_file()
    assert "Recall API Tester" in TESTER_PAGE.read_text()
