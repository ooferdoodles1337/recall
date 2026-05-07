from contextlib import asynccontextmanager

from fastapi import FastAPI

from routes import catalog as catalog_router, media, search, trials
from services import catalog, chroma, text_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    chroma.configure()
    catalog.configure()
    text_index.build()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(catalog_router.router, prefix="/catalog", tags=["catalog"])
app.include_router(media.router, prefix="/media", tags=["media"])
app.include_router(trials.router, prefix="/trials", tags=["trials"])


@app.get("/health")
def health():
    return {"status": "ok"}
