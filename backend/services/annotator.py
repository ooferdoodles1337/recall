import base64
import json
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from services import chroma

load_dotenv()
log = logging.getLogger(__name__)

ANNOTATION_MODEL = "gemini-3.1-flash-lite-preview"
PACK_SIZE = 10
POLL_INTERVAL_SECONDS = 30

_PROMPT_PATH = Path(__file__).parent / "prompts" / "annotation.txt"
_ANNOTATION_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")

_annotation_client: genai.Client | None = None

_TERMINAL_STATES = {
    "JOB_STATE_SUCCEEDED",
    "JOB_STATE_FAILED",
    "JOB_STATE_CANCELLED",
    "JOB_STATE_EXPIRED",
}


class SingleImageAnnotation(BaseModel):
    file_id: str
    description: str
    search_terms: list[str]


class PackedAnnotationResponse(BaseModel):
    annotations: list[SingleImageAnnotation]


def _get_annotation_client() -> genai.Client:
    global _annotation_client
    if _annotation_client is None:
        _annotation_client = genai.Client(
            api_key=os.getenv("GEMINI_API_KEY"),
            http_options={"api_version": "v1alpha"},
        )
    return _annotation_client


def _get_unannotated() -> list[dict]:
    all_items = chroma.get_all_items_with_metadata()
    return [item for item in all_items if not (item["metadata"] or {}).get("description")]


def _load_item_bytes(item: dict) -> tuple[str, bytes, str] | None:
    meta = item["metadata"] or {}
    path = meta.get("path")
    mime_type = meta.get("mime_type")
    if not path or not mime_type:
        log.warning("item %s missing path or mime_type", item["id"])
        return None
    try:
        data = Path(path).read_bytes()
        return (item["id"], data, mime_type)
    except Exception as exc:
        log.error("failed to load %s: %s", path, exc)
        return None


def _inline_schema(schema: dict) -> dict:
    """Resolve $ref/$defs so the schema is a flat inline object (Gemini requirement)."""
    defs = schema.get("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                return resolve(defs[ref_name])
            return {k: resolve(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


def _build_pack_request(pack: list[tuple[str, bytes, str]]) -> dict:
    parts = []

    for file_id, image_bytes, mime_type in pack:
        parts.append({"text": f"[Image ID: {file_id}]"})
        resolution = (
            "MEDIA_RESOLUTION_MEDIUM" if mime_type.startswith("image/")
            else "MEDIA_RESOLUTION_LOW"
        )
        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(image_bytes).decode(),
            },
            "video_metadata": {"resolution": resolution} if not mime_type.startswith("image/") else None,
        })

    parts.append({"text": _ANNOTATION_PROMPT})

    # Remove None values from parts
    parts = [{k: v for k, v in p.items() if v is not None} for p in parts]

    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": _inline_schema(PackedAnnotationResponse.model_json_schema()),
        },
    }


def _submit_via_file(packs: list[list[tuple[str, bytes, str]]]) -> object:
    client = _get_annotation_client()
    jsonl_path = Path("backend/data/annotation_requests.jsonl")
    jsonl_path.parent.mkdir(parents=True, exist_ok=True)

    with jsonl_path.open("w") as f:
        for i, pack in enumerate(packs):
            record = {"key": f"pack-{i}", "request": _build_pack_request(pack)}
            f.write(json.dumps(record) + "\n")

    uploaded = client.files.upload(
        file=str(jsonl_path),
        config=types.UploadFileConfig(
            display_name="recall-annotation-requests",
            mime_type="jsonl",
        ),
    )
    log.info("uploaded JSONL file: %s", uploaded.name)

    return client.batches.create(
        model=ANNOTATION_MODEL,
        src=uploaded.name,
        config={"display_name": "recall-annotation"},
    )


def _poll_until_complete(job) -> object:
    client = _get_annotation_client()
    while job.state.name not in _TERMINAL_STATES:
        log.info(
            "annotation batch state: %s — waiting %ds",
            job.state.name,
            POLL_INTERVAL_SECONDS,
        )
        time.sleep(POLL_INTERVAL_SECONDS)
        job = client.batches.get(name=job.name)
    return job


def _parse_file_results(job) -> dict[str, SingleImageAnnotation]:
    client = _get_annotation_client()
    results = {}
    raw_bytes = client.files.download(file=job.dest.file_name)
    for line in raw_bytes.decode("utf-8").splitlines():
        if not line:
            continue
        record = json.loads(line)
        if "error" in record:
            log.error("pack %s failed: %s", record.get("key"), record["error"])
            continue
        try:
            response_text = (
                record["response"]["candidates"][0]["content"]["parts"][0]["text"]
            )
            parsed = PackedAnnotationResponse.model_validate_json(response_text)
            for annotation in parsed.annotations:
                results[annotation.file_id] = annotation
        except Exception as exc:
            log.error("pack %s parse error: %s", record.get("key"), exc)
    return results


def _write_annotations(
    annotations: dict[str, SingleImageAnnotation],
    expected_ids: set[str],
) -> None:
    for file_id, annotation in annotations.items():
        if file_id not in expected_ids:
            log.warning("unexpected file_id in response: %s", file_id)
            continue
        try:
            chroma.update_metadata(file_id, {
                "description": annotation.description,
                "search_terms": json.dumps(annotation.search_terms),
            })
        except Exception as exc:
            log.error("failed to write annotation for %s: %s", file_id, exc)

    written = len(annotations)
    expected = len(expected_ids)
    if written < expected:
        log.warning(
            "%d items were not annotated (expected %d)",
            expected - written,
            expected,
        )


def annotate_unannotated() -> None:
    unannotated = _get_unannotated()
    if not unannotated:
        log.info("all items already annotated")
        return

    log.info("annotating %d items", len(unannotated))
    expected_ids = {item["id"] for item in unannotated}

    loaded = [_load_item_bytes(item) for item in unannotated]
    loaded = [x for x in loaded if x is not None]

    packs = [loaded[i:i + PACK_SIZE] for i in range(0, len(loaded), PACK_SIZE)]
    log.info("submitting %d packs to Batch API via file upload", len(packs))

    job = _submit_via_file(packs)
    log.info("batch job created: %s", job.name)

    job = _poll_until_complete(job)

    if job.state.name != "JOB_STATE_SUCCEEDED":
        raise RuntimeError(f"annotation batch did not succeed: {job.state.name}")

    annotations = _parse_file_results(job)
    _write_annotations(annotations, expected_ids)
    log.info(
        "annotation complete: %d/%d items annotated",
        len(annotations),
        len(loaded),
    )
