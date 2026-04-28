from fastapi.testclient import TestClient


def test_tester_route_returns_html(monkeypatch):
    monkeypatch.setattr("services.chroma.configure", lambda path=None: None)
    monkeypatch.setattr("services.text_index.build", lambda: None)

    from main import app

    with TestClient(app) as client:
        response = client.get("/tester")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Recall API Tester" in response.text
