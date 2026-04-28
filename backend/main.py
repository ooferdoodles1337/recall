from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import collection, media, search, trials
from services import chroma, text_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    chroma.configure()
    text_index.build()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(media.router, prefix="/media", tags=["media"])
app.include_router(trials.router, prefix="/trials", tags=["trials"])
app.include_router(collection.router, prefix="/collection", tags=["collection"])


@app.get("/health")
def health():
    return {"status": "ok"}
