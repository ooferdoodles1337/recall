import argparse
import time
from pathlib import Path

from dotenv import load_dotenv

from services.search import chroma
from services.providers import gemini

load_dotenv()


def query_collection(text: str, db_path: str | None = None, n_results: int = 5) -> None:
    if db_path is not None:
        chroma.configure(db_path)

    # --- Time embedding ---
    t0 = time.perf_counter()
    embedding = gemini.embed_text(text)
    embed_time = time.perf_counter() - t0

    # --- Time vector search ---
    t0 = time.perf_counter()
    results = chroma.search(embedding, n_results=n_results)
    search_time = time.perf_counter() - t0

    ids = results.get("ids", [[]])[0]
    distances = results.get("distances", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]

    print(f"Query: \"{text}\"")
    print(f"Top K: {n_results}")
    print(f"Embedding time: {embed_time * 1000:.2f} ms")
    print(f"Vector search time: {search_time * 1000:.2f} ms")
    print(f"Total time: {(embed_time + search_time) * 1000:.2f} ms")
    print()

    if not ids:
        print("No results found.")
        return

    print("Results:")
    for rank, (doc_id, dist, meta) in enumerate(zip(ids, distances, metadatas), start=1):
        filename = meta.get("filename", "N/A") if meta else "N/A"
        mime = meta.get("mime_type", "N/A") if meta else "N/A"
        media_type = meta.get("media_type", "N/A") if meta else "N/A"
        print(f"  {rank}. {filename}")
        print(f"     ID:       {doc_id}")
        print(f"     Distance: {dist:.4f}")
        print(f"     Type:     {media_type} ({mime})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Semantic search over indexed media")
    parser.add_argument("query", help="Search query text")
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to the ChromaDB persistent directory (default: backend/data/databases/chroma_db)",
    )
    parser.add_argument(
        "-n",
        "--top-k",
        type=int,
        default=5,
        help="Number of top results to return (default: 5)",
    )
    args = parser.parse_args()

    query_collection(args.query, db_path=args.db_path, n_results=args.top_k)


if __name__ == "__main__":
    main()
