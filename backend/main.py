from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from routes import collection, media, search, trials
from services import catalog, chroma, text_index

TESTER_PAGE = Path(__file__).resolve().parent / "devtools" / "endpoint_tester" / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    chroma.configure()
    catalog.configure()
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


@app.get("/tester", include_in_schema=False)
def tester():
    return FileResponse(TESTER_PAGE)


@app.get("/health")
def health():
    return {"status": "ok"}
