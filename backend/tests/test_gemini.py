from unittest.mock import MagicMock, patch


def _make_mock_result(n: int = 3072):
    mock_result = MagicMock()
    mock_result.embeddings = [MagicMock()]
    mock_result.embeddings[0].values = [0.1] * n
    return mock_result


def test_embed_text_returns_list_of_floats():
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_text
        result = embed_text("hello world")
    assert isinstance(result, list)
    assert len(result) == 3072
    assert all(isinstance(v, float) for v in result)


def test_embed_text_calls_correct_model():
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_text, _MODEL
        embed_text("hello")
    call_kwargs = mock_client.models.embed_content.call_args[1]
    assert call_kwargs["model"] == _MODEL


def test_embed_content_returns_list_of_floats():
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_content
        result = embed_content(b"\xff\xd8\xff", "image/jpeg")
    assert isinstance(result, list)
    assert len(result) == 3072
    assert all(isinstance(v, float) for v in result)


def test_embed_content_passes_bytes_as_part():
    from google.genai import types
    with patch("services.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.gemini import embed_content
        embed_content(b"test-bytes", "image/jpeg")
    call_kwargs = mock_client.models.embed_content.call_args[1]
    contents = call_kwargs["contents"]
    assert len(contents) == 1
    assert isinstance(contents[0], types.Part)
