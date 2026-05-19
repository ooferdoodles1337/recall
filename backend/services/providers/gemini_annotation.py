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

from services.providers.gemini import MAX_BATCH_INPUT_FILE_BYTES
from services.utils import format_bytes, inline_schema

load_dotenv()

log = logging.getLogger(__name__)

_annotation_client: genai.Client | None = None
_ANNOTATION_TERMINAL_STATES = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
_ANNOTATION_POLL_INTERVAL = 30
DEFAULT_ANNOTATION_BATCH_MAX_JSONL_BYTES = 512 * 1024 * 1024


def _get_annotation_client() -> genai.Client:
    global _annotation_client
    if _annotation_client is None:
        _annotation_client = genai.Client(
            api_key=os.getenv("GEMINI_API_KEY"),
            http_options={"api_version": "v1alpha"},
        )
    return _annotation_client


def _build_annotation_request(pack: list[tuple[str, bytes, str]], prompt: str, response_schema: dict) -> dict:
    parts = []
    for file_id, media_bytes, mime_type in pack:
        parts.append({"text": f"[Image ID: {file_id}]"})
        part: dict = {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(media_bytes).decode()}}
        if not mime_type.startswith("image/"):
            part["video_metadata"] = {"resolution": "MEDIA_RESOLUTION_LOW"}
        parts.append(part)
    parts.append({"text": prompt})
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": response_schema,
        },
    }


def _annotation_request_line(index: int, pack: list[tuple[str, bytes, str]], prompt: str, response_schema: dict) -> str:
    record = {"key": f"pack-{index}", "request": _build_annotation_request(pack, prompt, response_schema)}
    return json.dumps(record) + "\n"


def _chunk_annotation_request_lines(
    packs: list[list[tuple[str, bytes, str]]],
    prompt: str,
    response_schema: dict,
    max_jsonl_bytes: int,
) -> Iterable[tuple[list[str], int]]:
    if max_jsonl_bytes <= 0:
        raise ValueError("max_jsonl_bytes must be positive")

    chunk: list[str] = []
    chunk_bytes = 0

    for i, pack in enumerate(packs):
        line = _annotation_request_line(i, pack, prompt, response_schema)
        line_bytes = len(line.encode("utf-8"))
        if line_bytes > MAX_BATCH_INPUT_FILE_BYTES:
            raise ValueError(
                f"annotation request pack-{i} is {line_bytes:,} JSONL bytes, "
                f"above the Batch API input file limit of {MAX_BATCH_INPUT_FILE_BYTES:,} bytes"
            )
        if chunk and chunk_bytes + line_bytes > max_jsonl_bytes:
            yield chunk, chunk_bytes
            chunk = []
            chunk_bytes = 0
        chunk.append(line)
        chunk_bytes += line_bytes

        if line_bytes > max_jsonl_bytes:
            yield chunk, chunk_bytes
            chunk = []
            chunk_bytes = 0

    if chunk:
        yield chunk, chunk_bytes


def _run_annotation_batch_job(
    client: genai.Client,
    model: str,
    lines: list[str],
    *,
    chunk_index: int,
) -> dict[int, str]:
    started_at = time.monotonic()
    with tempfile.NamedTemporaryFile(suffix=".jsonl", mode="w", delete=False, encoding="utf-8") as f:
        tmp_path = f.name
        for line in lines:
            f.write(line)

    tmp_size = Path(tmp_path).stat().st_size
    log.info(
        "annotation JSONL ready: chunk=%d path=%s size=%s packs=%d",
        chunk_index,
        tmp_path,
        format_bytes(tmp_size),
        len(lines),
    )
    try:
        uploaded = client.files.upload(
            file=tmp_path,
            config=types.UploadFileConfig(
                display_name=f"recall-annotation-requests-{chunk_index:04d}",
                mime_type="jsonl",
            ),
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    log.info("uploaded annotation JSONL: chunk=%d file=%s", chunk_index, uploaded.name)
    job = client.batches.create(
        model=model,
        src=uploaded.name,
        config={"display_name": f"recall-annotation-{chunk_index:04d}"},
    )
    log.info("batch annotation job created: %s", job.name)

    poll_count = 0
    while job.state.name not in _ANNOTATION_TERMINAL_STATES:
        poll_count += 1
        log.info(
            "annotation batch %s state=%s poll=%d elapsed=%.1fs, waiting %ds",
            job.name,
            job.state.name,
            poll_count,
            time.monotonic() - started_at,
            _ANNOTATION_POLL_INTERVAL,
        )
        time.sleep(_ANNOTATION_POLL_INTERVAL)
        job = client.batches.get(name=job.name)

    if job.state.name != "JOB_STATE_SUCCEEDED":
        raise RuntimeError(f"annotation batch did not succeed: {job.state.name}")

    log.info("annotation batch succeeded: %s elapsed=%.1fs", job.name, time.monotonic() - started_at)
    raw_bytes = client.files.download(file=job.dest.file_name)
    log.info("annotation result downloaded: job=%s size=%s", job.name, format_bytes(len(raw_bytes)))
    pack_texts: dict[int, str] = {}
    for line in raw_bytes.decode("utf-8").splitlines():
        if not line:
            continue
        record = json.loads(line)
        if "error" in record:
            log.error("pack %s failed: %s", record.get("key"), record["error"])
            continue
        try:
            idx = int(record["key"].split("-")[1])
            pack_texts[idx] = record["response"]["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as exc:
            log.error("pack %s parse error: %s", record.get("key"), exc)

    log.info("annotation result parsed: job=%s packs=%d/%d", job.name, len(pack_texts), len(lines))
    return pack_texts


def annotate_packs_batch(
    packs: list[list[tuple[str, bytes, str]]],
    model: str,
    prompt: str,
    pydantic_schema: dict,
    max_jsonl_bytes: int = DEFAULT_ANNOTATION_BATCH_MAX_JSONL_BYTES,
) -> list[str | None]:
    """Submit all packs as a Gemini batch job; return per-pack JSON response strings."""
    client = _get_annotation_client()
    response_schema = inline_schema(pydantic_schema)

    pack_texts: dict[int, str] = {}
    chunks = list(_chunk_annotation_request_lines(packs, prompt, response_schema, max_jsonl_bytes))
    for i, (lines, estimated_bytes) in enumerate(chunks, start=1):
        log.info(
            "uploading annotation request JSONL %d/%d: %d packs, estimated %.1f MiB",
            i,
            len(chunks),
            len(lines),
            estimated_bytes / (1024 * 1024),
        )
        pack_texts.update(_run_annotation_batch_job(client, model, lines, chunk_index=i))

    return [pack_texts.get(i) for i in range(len(packs))]
