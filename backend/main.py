from contextlib import asynccontextmanager

from fastapi import FastAPI

from routes import collection, media, search, trials
from services import chroma


@asynccontextmanager
async def lifespan(app: FastAPI):
    chroma.configure()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(media.router, prefix="/media", tags=["media"])
app.include_router(trials.router, prefix="/trials", tags=["trials"])
app.include_router(collection.router, prefix="/collection", tags=["collection"])


@app.get("/health")
def health():
    return {"status": "ok"}
