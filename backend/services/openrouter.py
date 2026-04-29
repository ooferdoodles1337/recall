import base64
import logging
import os

import openai
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

_BASE_URL = "https://openrouter.ai/api/v1"
_client: openai.OpenAI | None = None


def _get_client() -> openai.OpenAI:
    global _client
    if _client is None:
        _client = openai.OpenAI(base_url=_BASE_URL, api_key=os.getenv("OPENROUTER_API_KEY"))
    return _client


def _build_messages(pack: list[tuple[str, bytes, str]], prompt: str) -> list[dict]:
    content: list[dict] = []
    for file_id, media_bytes, mime_type in pack:
        content.append({"type": "text", "text": f"[Image ID: {file_id}]"})
        b64 = base64.b64encode(media_bytes).decode()
        if mime_type.startswith("video/"):
            content.append({"type": "video_url", "video_url": {"url": f"data:{mime_type};base64,{b64}"}})
        else:
            content.append({"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}})
    content.append({"type": "text", "text": prompt})
    return [{"role": "user", "content": content}]


def _inline_schema(schema: dict) -> dict:
    """Resolve $ref/$defs into a flat inline object (required for strict structured outputs)."""
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


def annotate_packs(
    packs: list[list[tuple[str, bytes, str]]],
    model: str,
    prompt: str,
    pydantic_schema: dict,
) -> list[str | None]:
    """Annotate packs synchronously via OpenRouter; return per-pack JSON response strings."""
    client = _get_client()
    schema = _inline_schema(pydantic_schema)
    response_format = {
        "type": "json_schema",
        "json_schema": {"name": "annotation_response", "strict": True, "schema": schema},
    }
    results: list[str | None] = []
    for i, pack in enumerate(packs):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=_build_messages(pack, prompt),
                response_format=response_format,
            )
            text = (response.choices[0].message.content or "").strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
            results.append(text)
            log.info("pack %d/%d annotated via OpenRouter", i + 1, len(packs))
        except Exception as exc:
            log.error("pack %d failed: %s", i, exc)
            results.append(None)
    return results
