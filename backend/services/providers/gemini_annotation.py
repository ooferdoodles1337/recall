import asyncio
import logging
import os
import random
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import ServerError

from services.utils import inline_schema

load_dotenv()

log = logging.getLogger(__name__)

_annotation_client: genai.Client | None = None
_FILE_POLL_INTERVAL = 5
_MAX_UPLOAD_CONCURRENCY = 8
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0


@dataclass(frozen=True)
class _UploadedAnnotationMedia:
    file_id: str
    uri: str
    mime_type: str


def _get_annotation_client() -> genai.Client:
    # Return the module-level client if set (used by tests via monkeypatch).
    # In production this is always None, so a fresh client is created per call
    # to avoid event-loop reuse errors when asyncio.run() is called repeatedly.
    if _annotation_client is not None:
        return _annotation_client
    return genai.Client(
        api_key=os.getenv("GEMINI_API_KEY"),
        http_options={"api_version": "v1alpha"},
    )


def _file_state_name(file: types.File) -> str | None:
    state = getattr(file, "state", None)
    if state is None:
        return None
    if isinstance(state, str):
        return state
    return getattr(state, "name", None)


async def _wait_for_file_active(client: genai.Client, uploaded: types.File) -> types.File:
    state = _file_state_name(uploaded)
    while state == "PROCESSING":
        log.info("uploaded file processing: file=%s", uploaded.name)
        await asyncio.sleep(_FILE_POLL_INTERVAL)
        uploaded = await client.aio.files.get(name=uploaded.name)
        state = _file_state_name(uploaded)
    if state not in (None, "ACTIVE"):
        raise RuntimeError(f"uploaded file {uploaded.name} reached state {state}, cannot proceed")
    return uploaded


async def _upload_one_annotation_media(
    client: genai.Client,
    semaphore: asyncio.Semaphore,
    file_id: str,
    media_path: Path,
    mime_type: str,
    uploaded_files: list[types.File],
) -> _UploadedAnnotationMedia:
    async with semaphore:
        uploaded = await client.aio.files.upload(
            file=media_path,
            config=types.UploadFileConfig(
                display_name=f"recall-annotation-media-{file_id}",
                mime_type=mime_type,
            ),
        )
        uploaded_files.append(uploaded)
        uploaded = await _wait_for_file_active(client, uploaded)
        if not uploaded.uri:
            raise RuntimeError(f"uploaded file {uploaded.name} did not include a file URI")
        # The v1alpha client returns v1alpha file URIs for video files, but
        # generate_content can only fetch files via v1beta URIs. Normalize.
        file_uri = uploaded.uri.replace(
            "https://generativelanguage.googleapis.com/v1alpha/",
            "https://generativelanguage.googleapis.com/v1beta/",
        )
        log.info("uploaded annotation media: item=%s file=%s", file_id, uploaded.name)
        return _UploadedAnnotationMedia(file_id=file_id, uri=file_uri, mime_type=mime_type)


async def _upload_annotation_media(
    client: genai.Client,
    pack: list[tuple[str, Path, str]],
    uploaded_files: list[types.File],
) -> list[_UploadedAnnotationMedia]:
    semaphore = asyncio.Semaphore(_MAX_UPLOAD_CONCURRENCY)
    tasks = [
        asyncio.create_task(
            _upload_one_annotation_media(
                client,
                semaphore,
                file_id,
                media_path,
                mime_type,
                uploaded_files,
            )
        )
        for file_id, media_path, mime_type in pack
    ]
    try:
        return list(await asyncio.gather(*tasks))
    except Exception:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


async def _delete_uploaded_files(client: genai.Client, uploaded_files: list[types.File]) -> None:
    async def delete_one(uploaded: types.File) -> None:
        try:
            await client.aio.files.delete(name=uploaded.name)
        except Exception as exc:
            log.warning("failed to delete uploaded file %s: %s", uploaded.name, exc)

    await asyncio.gather(*(delete_one(uploaded) for uploaded in uploaded_files))


def _build_annotation_contents(pack: list[_UploadedAnnotationMedia], prompt: str) -> list[dict]:
    parts = []
    for media in pack:
        parts.append({"text": f"[Image ID: {media.file_id}]"})
        parts.append({"file_data": {"mime_type": media.mime_type, "file_uri": media.uri}})
    parts.append({"text": prompt})
    return [{"role": "user", "parts": parts}]


async def annotate_pack_async(
    pack: list[tuple[str, Path, str]],
    model: str,
    prompt: str,
    pydantic_schema: dict,
) -> str:
    """Upload one pack and annotate it, retrying on server errors up to _MAX_RETRIES times."""
    has_video = any(not mime.startswith("image/") for _, _, mime in pack)
    for attempt in range(_MAX_RETRIES + 1):
        client = _get_annotation_client()
        uploaded_files: list[types.File] = []
        try:
            uploaded_pack = await _upload_annotation_media(client, pack, uploaded_files)
            response = await client.aio.models.generate_content(
                model=model,
                contents=_build_annotation_contents(uploaded_pack, prompt),
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_json_schema=inline_schema(pydantic_schema),
                    media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW if has_video else None,
                ),
            )
            if not isinstance(response.text, str) or not response.text:
                raise RuntimeError("annotation response did not include text")
            return response.text
        except ServerError as exc:
            if attempt == _MAX_RETRIES:
                raise
            delay = _RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1)
            log.warning(
                "pack attempt %d/%d server error %s, retrying in %.1fs",
                attempt + 1,
                _MAX_RETRIES + 1,
                exc.code,
                delay,
            )
            await asyncio.sleep(delay)
        finally:
            await _delete_uploaded_files(client, uploaded_files)
    raise RuntimeError("unreachable")


def annotate_pack(
    pack: list[tuple[str, Path, str]],
    model: str,
    prompt: str,
    pydantic_schema: dict,
) -> str:
    """Annotate one prompt pack synchronously and return the JSON response text."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(annotate_pack_async(pack, model, prompt, pydantic_schema))
    raise RuntimeError(
        "annotate_pack() cannot run inside an active event loop; await annotate_pack_async() instead"
    )
