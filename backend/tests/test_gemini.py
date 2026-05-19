import json
from unittest.mock import MagicMock, patch


def _make_mock_result(n: int = 3072):
    mock_result = MagicMock()
    mock_result.embeddings = [MagicMock()]
    mock_result.embeddings[0].values = [0.1] * n
    return mock_result


def test_embed_text_returns_list_of_floats():
    with patch("services.providers.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.providers.gemini import embed_text
        result = embed_text("hello world")
    assert isinstance(result, list)
    assert len(result) == 3072
    assert all(isinstance(v, float) for v in result)


def test_embed_text_calls_correct_model():
    with patch("services.providers.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.providers.gemini import embed_text, _MODEL
        embed_text("hello")
    call_kwargs = mock_client.models.embed_content.call_args[1]
    assert call_kwargs["model"] == _MODEL


def test_embed_content_returns_list_of_floats():
    with patch("services.providers.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.providers.gemini import embed_content
        result = embed_content(b"\xff\xd8\xff", "image/jpeg")
    assert isinstance(result, list)
    assert len(result) == 3072
    assert all(isinstance(v, float) for v in result)


def test_embed_content_passes_bytes_as_part():
    from google.genai import types
    with patch("services.providers.gemini._client") as mock_client:
        mock_client.models.embed_content.return_value = _make_mock_result()
        from services.providers.gemini import embed_content
        embed_content(b"test-bytes", "image/jpeg")
    call_kwargs = mock_client.models.embed_content.call_args[1]
    contents = call_kwargs["contents"]
    assert len(contents) == 1
    assert isinstance(contents[0], types.Part)


def _make_batch_client(result_lines: list[str]):
    """Build a mock client that simulates a successful batch embeddings job."""
    uploaded_file = MagicMock()
    uploaded_file.name = "files/test-upload"

    batch_job = MagicMock()
    batch_job.name = "batches/test-job"
    batch_job.state.name = "JOB_STATE_SUCCEEDED"
    dest = MagicMock()
    dest.file_name = "files/test-result"
    batch_job.dest = dest

    mock_client = MagicMock()
    mock_client.files.upload.return_value = uploaded_file
    mock_client.batches.create_embeddings.return_value = batch_job
    mock_client.batches.get.return_value = batch_job
    mock_client.files.download.return_value = "\n".join(result_lines).encode("utf-8")
    return mock_client


def test_embed_content_batch_returns_embeddings():
    items = [("k1", b"\xff\xd8\xff", "image/jpeg"), ("k2", b"\x89PNG", "image/png")]
    result_lines = [
        json.dumps({"key": "k1", "response": {"embedding": {"values": [0.1] * 3072}}}),
        json.dumps({"key": "k2", "response": {"embedding": {"values": [0.2] * 3072}}}),
    ]
    with patch("services.providers.gemini._client", _make_batch_client(result_lines)):
        from services.providers.gemini import embed_content_batch
        result = embed_content_batch(items)

    assert set(result.keys()) == {"k1", "k2"}
    assert len(result["k1"]) == 3072
    assert result["k1"][0] == 0.1
    assert result["k2"][0] == 0.2


def test_embed_content_batch_skips_per_item_errors():
    items = [("k1", b"\xff\xd8\xff", "image/jpeg"), ("k2", b"video", "video/mp4")]
    result_lines = [
        json.dumps({"key": "k1", "response": {"embedding": {"values": [0.1] * 3072}}}),
        json.dumps({"key": "k2", "error": {"code": 400, "message": "bad video"}}),
    ]
    with patch("services.providers.gemini._client", _make_batch_client(result_lines)):
        from services.providers.gemini import embed_content_batch
        result = embed_content_batch(items)

    assert set(result.keys()) == {"k1"}
    assert len(result["k1"]) == 3072


def test_embed_content_batch_splits_large_jsonl_requests():
    from services.providers.gemini import estimate_embedding_request_jsonl_bytes

    items = [("k1", b"\xff\xd8\xff", "image/jpeg"), ("k2", b"\x89PNG", "image/png")]
    first_size = estimate_embedding_request_jsonl_bytes(*items[0])
    result_lines = [
        json.dumps({"key": "k1", "response": {"embedding": {"values": [0.1] * 3072}}}),
        json.dumps({"key": "k2", "response": {"embedding": {"values": [0.2] * 3072}}}),
    ]

    mock_client = _make_batch_client([])
    mock_client.files.download.side_effect = [line.encode("utf-8") for line in result_lines]

    with patch("services.providers.gemini._client", mock_client):
        from services.providers.gemini import embed_content_batch
        result = embed_content_batch(items, max_jsonl_bytes=first_size)

    assert set(result.keys()) == {"k1", "k2"}
    assert mock_client.files.upload.call_count == 2
    assert mock_client.batches.create_embeddings.call_count == 2


def test_embed_content_batch_raises_on_failure():
    batch_job = MagicMock()
    batch_job.name = "batches/failing-job"
    batch_job.state.name = "JOB_STATE_FAILED"

    mock_client = MagicMock()
    uploaded_file = MagicMock()
    uploaded_file.name = "files/test-upload"
    mock_client.files.upload.return_value = uploaded_file
    mock_client.batches.create_embeddings.return_value = batch_job
    mock_client.batches.get.return_value = batch_job

    import pytest
    with patch("services.providers.gemini._client", mock_client):
        from services.providers.gemini import embed_content_batch
        with pytest.raises(RuntimeError, match="JOB_STATE_FAILED"):
            embed_content_batch([("k1", b"data", "image/jpeg")])


def test_annotate_packs_batch_splits_large_jsonl_requests():
    uploaded_file = MagicMock()
    uploaded_file.name = "files/test-upload"

    batch_job = MagicMock()
    batch_job.name = "batches/test-job"
    batch_job.state.name = "JOB_STATE_SUCCEEDED"
    dest = MagicMock()
    dest.file_name = "files/test-result"
    batch_job.dest = dest

    mock_client = MagicMock()
    mock_client.files.upload.return_value = uploaded_file
    mock_client.batches.create.return_value = batch_job
    mock_client.files.download.side_effect = [
        json.dumps({
            "key": "pack-0",
            "response": {"candidates": [{"content": {"parts": [{"text": '{"annotations": []}'}]}}]},
        }).encode("utf-8"),
        json.dumps({
            "key": "pack-1",
            "response": {"candidates": [{"content": {"parts": [{"text": '{"annotations": []}'}]}}]},
        }).encode("utf-8"),
    ]

    packs = [
        [("id-1", b"\xff\xd8\xff", "image/jpeg")],
        [("id-2", b"\x89PNG", "image/png")],
    ]

    with patch("services.providers.gemini_annotation._annotation_client", mock_client):
        from services.providers.gemini_annotation import annotate_packs_batch

        result = annotate_packs_batch(
            packs,
            "gemini-test",
            "describe these",
            {"type": "object"},
            max_jsonl_bytes=1,
        )

    assert result == ['{"annotations": []}', '{"annotations": []}']
    assert mock_client.files.upload.call_count == 2
    assert mock_client.batches.create.call_count == 2
