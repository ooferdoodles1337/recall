import base64
import json
import logging
import os
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

log = logging.getLogger(__name__)

# ── Embedding ──────────────────────────────────────────────────────────────────

_MODEL = "gemini-embedding-2"
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _client


def embed_text(text: str) -> list[float]:
    result = _get_client().models.embed_content(model=_MODEL, contents=[text])
    return list(result.embeddings[0].values)


def embed_content(file_bytes: bytes, mime_type: str) -> list[float]:
    part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    result = _get_client().models.embed_content(model=_MODEL, contents=[part])
    return list(result.embeddings[0].values)


def embed_content_batch(items: list[tuple[str, bytes, str]]) -> dict[str, list[float]]:
    """Batch-embed binary content via the Gemini Batch API.

    items: list of (key, file_bytes, mime_type)
    Returns dict mapping key -> embedding values.
    """
    client = _get_client()

    with tempfile.NamedTemporaryFile(suffix=".jsonl", mode="w", delete=False, encoding="utf-8") as f:
        tmp_path = f.name
        for key, data, mime_type in items:
            b64 = base64.b64encode(data).decode("ascii")
            record = {
                "key": key,
                "request": {
                    "content": {
                        "parts": [{"inline_data": {"mime_type": mime_type, "data": b64}}]
                    }
                },
            }
            f.write(json.dumps(record) + "\n")

    try:
        uploaded = client.files.upload(
            file=tmp_path,
            config=types.UploadFileConfig(mime_type="jsonl"),
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    batch_job = client.batches.create_embeddings(
        model=_MODEL,
        src=types.EmbeddingsBatchJobSource(file_name=uploaded.name),
        config={"display_name": "recall-index-batch"},
    )
    log.info("batch embedding job submitted: %s", batch_job.name)

    while True:
        batch_job = client.batches.get(name=batch_job.name)
        if batch_job.state.name in ("JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED"):
            break
        log.info("batch job %s state=%s, waiting 30s...", batch_job.name, batch_job.state.name)
        time.sleep(30)

    if batch_job.state.name != "JOB_STATE_SUCCEEDED":
        raise RuntimeError(f"Batch embedding job {batch_job.name} ended with state {batch_job.state.name}")

    result_bytes = client.files.download(file=batch_job.dest.file_name)

    results: dict[str, list[float]] = {}
    for line in result_bytes.decode("utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        results[obj["key"]] = list(obj["response"]["embedding"]["values"])

    return results


# ── Annotation batch ───────────────────────────────────────────────────────────

_annotation_client: genai.Client | None = None
_ANNOTATION_TERMINAL_STATES = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
_ANNOTATION_POLL_INTERVAL = 30


def _get_annotation_client() -> genai.Client:
    global _annotation_client
    if _annotation_client is None:
        _annotation_client = genai.Client(
            api_key=os.getenv("GEMINI_API_KEY"),
            http_options={"api_version": "v1alpha"},
        )
    return _annotation_client


def _inline_schema(schema: dict) -> dict:
    """Resolve $ref/$defs into a flat inline object (Gemini API requirement)."""
    defs = schema.get("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(defs[node["$ref"].split("/")[-1]])
            return {k: resolve(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


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


def annotate_packs_batch(
    packs: list[list[tuple[str, bytes, str]]],
    model: str,
    prompt: str,
    pydantic_schema: dict,
) -> list[str | None]:
    """Submit all packs as a Gemini batch job; return per-pack JSON response strings."""
    client = _get_annotation_client()
    response_schema = _inline_schema(pydantic_schema)

    with tempfile.NamedTemporaryFile(suffix=".jsonl", mode="w", delete=False, encoding="utf-8") as f:
        tmp_path = f.name
        for i, pack in enumerate(packs):
            record = {"key": f"pack-{i}", "request": _build_annotation_request(pack, prompt, response_schema)}
            f.write(json.dumps(record) + "\n")

    try:
        uploaded = client.files.upload(
            file=tmp_path,
            config=types.UploadFileConfig(display_name="recall-annotation-requests", mime_type="jsonl"),
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    log.info("uploaded annotation JSONL: %s", uploaded.name)
    job = client.batches.create(model=model, src=uploaded.name, config={"display_name": "recall-annotation"})
    log.info("batch annotation job created: %s", job.name)

    while job.state.name not in _ANNOTATION_TERMINAL_STATES:
        log.info("annotation batch state: %s — waiting %ds", job.state.name, _ANNOTATION_POLL_INTERVAL)
        time.sleep(_ANNOTATION_POLL_INTERVAL)
        job = client.batches.get(name=job.name)

    if job.state.name != "JOB_STATE_SUCCEEDED":
        raise RuntimeError(f"annotation batch did not succeed: {job.state.name}")

    raw_bytes = client.files.download(file=job.dest.file_name)
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

    return [pack_texts.get(i) for i in range(len(packs))]
