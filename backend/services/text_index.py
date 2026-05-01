import bisect
import logging

from rapidfuzz import fuzz, process

from services import catalog, metadata_schema

log = logging.getLogger(__name__)

_term_list: list[tuple[str, str]] = []
_term_to_ids: dict[str, set[str]] = {}

FUZZY_THRESHOLD = 60


def build() -> None:
    global _term_list, _term_to_ids
    _term_list = []
    _term_to_ids = {}

    items = catalog.get_all_items_with_metadata()
    for item in items:
        meta = item["metadata"] or {}
        terms = metadata_schema.search_phrases(meta)
        if not terms:
            continue
        for term in terms:
            normalized = term.strip().lower()
            if not normalized:
                continue
            _term_list.append((normalized, item["id"]))
            if normalized not in _term_to_ids:
                _term_to_ids[normalized] = set()
            _term_to_ids[normalized].add(item["id"])

    _term_list.sort(key=lambda x: x[0])
    log.info(
        "text index built: %d unique terms, %d (term, id) pairs",
        len(_term_to_ids),
        len(_term_list),
    )


def rebuild() -> None:
    log.info("rebuilding text index")
    build()


def prefix_suggestions(prefix: str, n: int = 5) -> list[str]:
    if not prefix:
        return []

    normalized = prefix.strip().lower()
    lo = bisect.bisect_left(_term_list, (normalized,))
    seen: set[str] = set()
    results: list[str] = []

    for term, _ in _term_list[lo:]:
        if not term.startswith(normalized):
            break
        if term not in seen:
            seen.add(term)
            results.append(term)
        if len(results) >= n:
            break

    return results


def fuzzy_suggestions(query: str, n: int = 5) -> list[str]:
    if not query:
        return []

    normalized = query.strip().lower()
    all_terms = list(_term_to_ids.keys())
    matches = process.extract(
        normalized,
        all_terms,
        scorer=fuzz.WRatio,
        limit=n,
    )
    return [match[0] for match in matches if match[1] >= FUZZY_THRESHOLD]


def suggest(query: str, n: int = 5) -> list[str]:
    prefix_results = prefix_suggestions(query, n)
    if len(prefix_results) >= n:
        return prefix_results

    remaining = n - len(prefix_results)
    prefix_set = set(prefix_results)
    fuzzy_results = [
        term for term in fuzzy_suggestions(query, n)
        if term not in prefix_set
    ][:remaining]

    return prefix_results + fuzzy_results


def search_by_term(query: str) -> set[str]:
    normalized = query.strip().lower()
    ids: set[str] = set()

    if normalized in _term_to_ids:
        ids.update(_term_to_ids[normalized])
        return ids

    prefix_terms = prefix_suggestions(normalized, n=10)
    for term in prefix_terms:
        ids.update(_term_to_ids.get(term, set()))

    if ids:
        return ids

    fuzzy_terms = fuzzy_suggestions(normalized, n=5)
    for term in fuzzy_terms:
        ids.update(_term_to_ids.get(term, set()))

    return ids
