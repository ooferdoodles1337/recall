from contextlib import asynccontextmanager

from fastapi import FastAPI
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
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(catalog_router.router, prefix="/catalog", tags=["catalog"])
app.include_router(media.router, prefix="/media", tags=["media"])


@app.get("/health")
def health():
    return {"status": "ok"}
