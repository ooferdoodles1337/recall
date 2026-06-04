import json
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


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
    mock_client = _make_batch_client(result_lines)
    with patch("services.providers.gemini._client", mock_client):
        from services.providers.gemini import embed_content_batch
        result = embed_content_batch(items)

    assert set(result.keys()) == {"k1", "k2"}
    assert len(result["k1"]) == 3072
    assert result["k1"][0] == 0.1
    assert result["k2"][0] == 0.2
    assert mock_client.batches.create_embeddings.call_args.kwargs["src"] == {
        "file_name": "files/test-upload"
    }


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


def test_annotate_pack_uses_uploaded_file_uri_and_deletes_upload(tmp_path):
    def uploaded_file(name, uri=None):
        file = MagicMock()
        file.name = name
        file.uri = uri
        file.state.name = "ACTIVE"
        return file

    media_path = tmp_path / "photo.jpg"
    media_path.write_bytes(b"\xff\xd8\xff")
    mock_client = MagicMock()
    mock_client.aio.files.upload = AsyncMock(
        return_value=uploaded_file(
            "files/media-1",
            "https://generativelanguage.googleapis.com/v1beta/files/media-1",
        )
    )
    response = MagicMock()
    response.text = '{"annotations": []}'
    mock_client.aio.models.generate_content = AsyncMock(return_value=response)
    mock_client.aio.files.delete = AsyncMock()

    with patch("services.providers.gemini_annotation._annotation_client", mock_client):
        from services.providers.gemini_annotation import annotate_pack

        result = annotate_pack(
            [("id-1", media_path, "image/jpeg")],
            "gemini-test",
            "describe these",
            {"type": "object"},
        )

    assert result == '{"annotations": []}'
    assert mock_client.aio.files.upload.await_count == 1
    assert mock_client.aio.files.upload.await_args.kwargs["file"] == media_path
    assert mock_client.aio.models.generate_content.await_count == 1
    assert mock_client.aio.files.delete.await_args.kwargs == {"name": "files/media-1"}

    call_kwargs = mock_client.aio.models.generate_content.await_args.kwargs
    parts = call_kwargs["contents"][0]["parts"]
    assert parts[1]["file_data"] == {
        "mime_type": "image/jpeg",
        "file_uri": "https://generativelanguage.googleapis.com/v1beta/files/media-1",
    }
    assert "inline_data" not in parts[1]


def test_annotate_pack_uploads_media_concurrently(tmp_path):
    def uploaded_file(name, uri):
        file = MagicMock()
        file.name = name
        file.uri = uri
        file.state.name = "ACTIVE"
        return file

    paths = []
    for i in range(3):
        path = tmp_path / f"photo-{i}.jpg"
        path.write_bytes(b"\xff\xd8\xff")
        paths.append(path)

    active_uploads = 0
    max_active_uploads = 0

    async def upload(*, file: Path, config):
        nonlocal active_uploads, max_active_uploads
        active_uploads += 1
        max_active_uploads = max(max_active_uploads, active_uploads)
        await asyncio.sleep(0)
        active_uploads -= 1
        return uploaded_file(f"files/{file.stem}", f"https://example.test/{file.stem}")

    mock_client = MagicMock()
    mock_client.aio.files.upload = AsyncMock(side_effect=upload)
    mock_client.aio.files.delete = AsyncMock()
    response = MagicMock()
    response.text = '{"annotations": []}'
    mock_client.aio.models.generate_content = AsyncMock(return_value=response)

    with patch("services.providers.gemini_annotation._annotation_client", mock_client):
        from services.providers.gemini_annotation import annotate_pack

        annotate_pack(
            [(f"id-{i}", path, "image/jpeg") for i, path in enumerate(paths)],
            "gemini-test",
            "describe these",
            {"type": "object"},
        )

    assert max_active_uploads > 1
    assert mock_client.aio.files.upload.await_count == 3
    assert mock_client.aio.files.delete.await_count == 3


def _make_uploaded_file(name, uri=None):
    from unittest.mock import MagicMock
    f = MagicMock()
    f.name = name
    f.uri = uri or f"https://generativelanguage.googleapis.com/v1beta/{name}"
    f.state.name = "ACTIVE"
    return f


def test_annotate_pack_retries_on_server_error(tmp_path):
    from unittest.mock import AsyncMock, MagicMock, patch
    from google.genai.errors import ServerError

    media_path = tmp_path / "photo.jpg"
    media_path.write_bytes(b"\xff\xd8\xff")

    mock_client = MagicMock()
    mock_client.aio.files.upload = AsyncMock(
        side_effect=[_make_uploaded_file("files/a"), _make_uploaded_file("files/b")]
    )
    mock_client.aio.files.delete = AsyncMock()

    server_err = ServerError(500, {"error": {"code": 500, "message": "oops", "status": "INTERNAL"}})
    ok_response = MagicMock()
    ok_response.text = '{"annotations": []}'
    mock_client.aio.models.generate_content = AsyncMock(side_effect=[server_err, ok_response])

    with patch("services.providers.gemini_annotation._annotation_client", mock_client):
        with patch("services.providers.gemini_annotation._RETRY_BASE_DELAY", 0):
            with patch("asyncio.sleep", AsyncMock()):
                from services.providers.gemini_annotation import annotate_pack
                result = annotate_pack([("id-1", media_path, "image/jpeg")], "model", "prompt", {})

    assert result == '{"annotations": []}'
    assert mock_client.aio.models.generate_content.await_count == 2
    assert mock_client.aio.files.upload.await_count == 2
    assert mock_client.aio.files.delete.await_count == 2


def test_annotate_pack_raises_after_max_retries(tmp_path):
    from unittest.mock import AsyncMock, MagicMock, patch
    from google.genai.errors import ServerError
    import pytest

    media_path = tmp_path / "photo.jpg"
    media_path.write_bytes(b"\xff\xd8\xff")

    mock_client = MagicMock()
    mock_client.aio.files.upload = AsyncMock(
        side_effect=[_make_uploaded_file(f"files/f{i}") for i in range(10)]
    )
    mock_client.aio.files.delete = AsyncMock()

    server_err = ServerError(500, {"error": {"code": 500, "message": "oops", "status": "INTERNAL"}})
    mock_client.aio.models.generate_content = AsyncMock(side_effect=server_err)

    from services.providers.gemini_annotation import _MAX_RETRIES

    with patch("services.providers.gemini_annotation._annotation_client", mock_client):
        with patch("services.providers.gemini_annotation._RETRY_BASE_DELAY", 0):
            with patch("asyncio.sleep", AsyncMock()):
                from services.providers.gemini_annotation import annotate_pack
                with pytest.raises(ServerError):
                    annotate_pack([("id-1", media_path, "image/jpeg")], "model", "prompt", {})

    assert mock_client.aio.models.generate_content.await_count == _MAX_RETRIES + 1
    assert mock_client.aio.files.upload.await_count == _MAX_RETRIES + 1
    assert mock_client.aio.files.delete.await_count == _MAX_RETRIES + 1


def test_annotation_request_references_uploaded_file_uri():
    from services.providers.gemini_annotation import _UploadedAnnotationMedia, _build_annotation_contents

    contents = _build_annotation_contents(
        [
            _UploadedAnnotationMedia(
                "id-1",
                "https://generativelanguage.googleapis.com/v1beta/files/media-1",
                "image/jpeg",
            )
        ],
        "describe these",
    )
    parts = contents[0]["parts"]

    assert parts[1]["file_data"] == {
        "mime_type": "image/jpeg",
        "file_uri": "https://generativelanguage.googleapis.com/v1beta/files/media-1",
    }
    assert "inline_data" not in parts[1]
