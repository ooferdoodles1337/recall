import bisect
import logging

from rapidfuzz import fuzz, process

from services.catalog import db as catalog
log = logging.getLogger(__name__)

_term_list: list[tuple[str, str]] = []
_term_to_ids: dict[str, set[str]] = {}

FUZZY_THRESHOLD = 60


def build() -> None:
    global _term_list, _term_to_ids
    _term_list = []
    _term_to_ids = {}

    for item_id, terms in catalog.get_all_search_terms():
        if not terms:
            continue
        for term in terms:
            normalized = term.strip().lower()
            if not normalized:
                continue
            _term_list.append((normalized, item_id))
            if normalized not in _term_to_ids:
                _term_to_ids[normalized] = set()
            _term_to_ids[normalized].add(item_id)

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


def search_by_term(query: str) -> list[str]:
    """Return matching item ids in a deterministic, tiered order.

    Tiers (best first): exact term match, then prefix matches, then fuzzy
    matches. Ids are deduplicated across tiers and sorted within each tier so
    the result is stable across runs (a plain set was not).
    """
    normalized = query.strip().lower()

    exact = _term_to_ids.get(normalized)
    if exact:
        return sorted(exact)

    def _collect(terms: list[str]) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()
        for term in terms:
            for item_id in sorted(_term_to_ids.get(term, set())):
                if item_id not in seen:
                    seen.add(item_id)
                    ordered.append(item_id)
        return ordered

    prefix_ids = _collect(prefix_suggestions(normalized, n=10))
    if prefix_ids:
        return prefix_ids

    return _collect(fuzzy_suggestions(normalized, n=5))
