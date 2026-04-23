import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

_MODEL = "gemini-embedding-2"
_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def embed_text(text: str) -> list[float]:
    result = _client.models.embed_content(model=_MODEL, contents=[text])
    return list(result.embeddings[0].values)


def embed_content(file_bytes: bytes, mime_type: str) -> list[float]:
    part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    result = _client.models.embed_content(model=_MODEL, contents=[part])
    return list(result.embeddings[0].values)
