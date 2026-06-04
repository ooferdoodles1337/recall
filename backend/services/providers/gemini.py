import base64
import json
import logging
import os
import tempfile
import time
from collections.abc import Iterable
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

from services.utils import format_bytes

load_dotenv()

log = logging.getLogger(__name__)

_MODEL = "gemini-embedding-2"
_client: genai.Client | None = None
MAX_BATCH_INPUT_FILE_BYTES = 2_000_000_000
DEFAULT_EMBEDDING_BATCH_MAX_JSONL_BYTES = 512 * 1024 * 1024


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY must be set before calling Gemini embedding APIs")
        _client = genai.Client(api_key=api_key)
    return _client


def embed_text(text: str) -> list[float]:
    result = _get_client().models.embed_content(model=_MODEL, contents=[text])
    return list(result.embeddings[0].values)


def embed_content(file_bytes: bytes, mime_type: str) -> list[float]:
    part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    result = _get_client().models.embed_content(model=_MODEL, contents=[part])
    return list(result.embeddings[0].values)


def _base64_encoded_len(byte_count: int) -> int:
    return ((byte_count + 2) // 3) * 4


def estimate_embedding_request_jsonl_bytes(key: str, data: bytes, mime_type: str) -> int:
    """Estimate the JSONL bytes required for one inline embedding request."""
    empty_record = {
        "key": key,
        "request": {
            "content": {
                "parts": [{"inline_data": {"mime_type": mime_type, "data": ""}}]
            }
        },
    }
    empty_line_bytes = len(json.dumps(empty_record).encode("utf-8")) + 1
    return empty_line_bytes + _base64_encoded_len(len(data))


def _embedding_request_line(key: str, data: bytes, mime_type: str) -> str:
    b64 = base64.b64encode(data).decode("ascii")
    record = {
        "key": key,
        "request": {
            "content": {
                "parts": [{"inline_data": {"mime_type": mime_type, "data": b64}}]
            }
        },
    }
    return json.dumps(record) + "\n"


def _chunk_embedding_items(
    items: Iterable[tuple[str, bytes, str]],
    max_jsonl_bytes: int,
) -> Iterable[tuple[list[tuple[str, bytes, str]], int]]:
    if max_jsonl_bytes <= 0:
        raise ValueError("max_jsonl_bytes must be positive")

    chunk: list[tuple[str, bytes, str]] = []
    chunk_bytes = 0

    for key, data, mime_type in items:
        item_bytes = estimate_embedding_request_jsonl_bytes(key, data, mime_type)
        if item_bytes > MAX_BATCH_INPUT_FILE_BYTES:
            raise ValueError(
                f"embedding request for {key} is {item_bytes:,} JSONL bytes, "
                f"above the Batch API input file limit of {MAX_BATCH_INPUT_FILE_BYTES:,} bytes"
            )
        if chunk and chunk_bytes + item_bytes > max_jsonl_bytes:
            yield chunk, chunk_bytes
            chunk = []
            chunk_bytes = 0
        chunk.append((key, data, mime_type))
        chunk_bytes += item_bytes

        if item_bytes > max_jsonl_bytes:
            yield chunk, chunk_bytes
            chunk = []
            chunk_bytes = 0

    if chunk:
        yield chunk, chunk_bytes


def _write_embedding_request_file(items: list[tuple[str, bytes, str]]) -> str:
    with tempfile.NamedTemporaryFile(suffix=".jsonl", mode="w", delete=False, encoding="utf-8") as f:
        tmp_path = f.name
        for key, data, mime_type in items:
            f.write(_embedding_request_line(key, data, mime_type))
    return tmp_path


def _run_embedding_batch_job(
    client: genai.Client,
    items: list[tuple[str, bytes, str]],
    *,
    chunk_index: int,
) -> dict[str, list[float]]:
    started_at = time.monotonic()
    tmp_path = _write_embedding_request_file(items)
    tmp_size = Path(tmp_path).stat().st_size
    log.info(
        "embedding JSONL ready: chunk=%d path=%s size=%s items=%d",
        chunk_index,
        tmp_path,
        format_bytes(tmp_size),
        len(items),
    )
    try:
        uploaded = client.files.upload(
            file=tmp_path,
            config=types.UploadFileConfig(mime_type="jsonl"),
        )
        log.info("embedding JSONL uploaded: chunk=%d file=%s", chunk_index, uploaded.name)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    batch_job = client.batches.create_embeddings(
        model=_MODEL,
        src=types.EmbeddingsBatchJobSource(file_name=uploaded.name),
        config={"display_name": f"recall-index-batch-{chunk_index:04d}"},
    )
    log.info("batch embedding job submitted: %s", batch_job.name)

    poll_count = 0
    while True:
        batch_job = client.batches.get(name=batch_job.name)
        if batch_job.state.name in ("JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED"):
            break
        poll_count += 1
        log.info(
            "batch job %s state=%s poll=%d elapsed=%.1fs, waiting 30s...",
            batch_job.name,
            batch_job.state.name,
            poll_count,
            time.monotonic() - started_at,
        )
        time.sleep(30)

    if batch_job.state.name != "JOB_STATE_SUCCEEDED":
        raise RuntimeError(f"Batch embedding job {batch_job.name} ended with state {batch_job.state.name}")

    log.info("batch embedding job succeeded: %s elapsed=%.1fs", batch_job.name, time.monotonic() - started_at)
    result_bytes = client.files.download(file=batch_job.dest.file_name)
    log.info(
        "embedding result downloaded: job=%s size=%s",
        batch_job.name,
        format_bytes(len(result_bytes)),
    )

    results: dict[str, list[float]] = {}
    failed_keys: list[str] = []
    for line in result_bytes.decode("utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        key = obj.get("key", "<missing-key>")
        if "error" in obj:
            failed_keys.append(key)
            log.error("embedding item %s failed in batch %s: %s", key, batch_job.name, obj["error"])
            continue

        try:
            results[key] = list(obj["response"]["embedding"]["values"])
        except Exception as exc:
            failed_keys.append(key)
            log.error("embedding item %s parse error in batch %s: %s", key, batch_job.name, exc)

    log.info(
        "embedding result parsed: job=%s vectors=%d failed=%d",
        batch_job.name,
        len(results),
        len(failed_keys),
    )
    return results


def embed_content_batch(
    items: list[tuple[str, bytes, str]],
    max_jsonl_bytes: int = DEFAULT_EMBEDDING_BATCH_MAX_JSONL_BYTES,
) -> dict[str, list[float]]:
    """Batch-embed binary content via the Gemini Batch API.

    items: list of (key, file_bytes, mime_type)
    Returns dict mapping key -> embedding values.
    """
    client = _get_client()

    results: dict[str, list[float]] = {}
    chunks = list(_chunk_embedding_items(items, max_jsonl_bytes))
    for i, (chunk, estimated_bytes) in enumerate(chunks, start=1):
        log.info(
            "uploading embedding request JSONL %d/%d: %d items, estimated %.1f MiB",
            i,
            len(chunks),
            len(chunk),
            estimated_bytes / (1024 * 1024),
        )
        results.update(_run_embedding_batch_job(client, chunk, chunk_index=i))

    return results
