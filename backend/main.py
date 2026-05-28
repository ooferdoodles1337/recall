from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from routes import catalog as catalog_router, media, search
from services.catalog import db as catalog
from services.search import chroma, text_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    chroma.configure()
    catalog.configure()
    text_index.build()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=(
        r"^http://(localhost|127\.0\.0\.1"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}"
        r"):\d+$"
    ),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(catalog_router.router, prefix="/catalog", tags=["catalog"])
app.include_router(media.router, prefix="/media", tags=["media"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/trials")
def trials(n: int = Query(5, ge=1)):
    targets = [catalog.get_item_summary(item_id) for item_id in catalog.get_random_ids(n)]
    return {
        "n": n,
        "targets": [target for target in targets if target is not None],
    }
