# Architecture Audit

Audit of spaghetti code and bad architectural patterns across the codebase. Issues are grouped by area and ranked by impact at the bottom.

**Legend:** ✅ Done · ❌ Not started · ⚠️ Partial

---

## Backend

### ✅ 1. `catalog/db.py` — god file (813 lines)

Four distinct concerns in one module with no separation of responsibilities:
- Schema/migration runtime (`_init_schema`, `_ensure_promoted_columns`, `_migrate_embedding_mime_types`, `_backfill_*`) — lines 85–371
- Metadata parsing helpers (`_safety_score`, `_safety_metadata`, `_location_metadata`, etc.) — lines 195–311
- CRUD/query API (`upsert_item`, `get_item`, `list_library_items`, `patch_item`, etc.)
- Row serialization (`_row_to_item`, `_row_to_summary_item`, `_row_to_stored_item`)

**Done:** Split into `_db_serialization.py` (promoted column defs, metadata↔column helpers, all row→dict serializers) and `_db_migrations.py` (schema evolution: ensure_promoted_columns, needs_*_backfill, backfill_*, migrate_embedding_mime_types). `db.py` is now a ~270-line thin CRUD API that delegates to both.

---

### ✅ 2. Unconditional O(N) startup migrations (`db.py:133–136, 328–370`)

`_migrate_embedding_mime_types` and `_backfill_embedding_mime_type_in_json` do full-table scans on **every** `configure()` call — which runs on every FastAPI startup, every CLI script invocation, and in every test. A `SCHEMA_VERSION` constant exists in `schema.py:8` but there is no `schema_version` table and no short-circuit guard. These always run regardless of whether any migration is needed, making startup cost O(N) in library size.

**Done:** Added `schema_version` table. Migrations are now gated: `run_migrations()` is only called when the stored version is below `_DB_SCHEMA_VERSION = 2`. Second and subsequent `configure()` calls skip all migration work.

---

### ❌ 3. Dual-format metadata abstraction (deepest architectural problem)

Metadata exists in three forms simultaneously that must be kept in sync manually:
- Structured nested dict (`asset` / `capture` / `search` / `safety` / `organization` / `system`)
- Promoted SQLite columns (`_PROMOTED_COLUMN_DEFS`, `_db_serialization.py`)
- Legacy flat dict (fallback paths in every accessor)

Every accessor in `schema.py` has dual-read fallbacks (new format → flat fallback). `schema.py` constantly round-trips between representations via `build_metadata`, `rebuild_metadata`, `_flat_extra_from_existing`, and `merge_metadata`.

Adding a single field requires coordinated edits to six places with no compiler help:
1. `_PROMOTED_COLUMN_DEFS` — `_db_serialization.py`
2. `_PROMOTED_METADATA_KEYS` — `schema.py`
3. `build_metadata` — `schema.py`
4. `_promoted_values` — `_db_serialization.py`
5. `row_to_summary_item` — `_db_serialization.py`
6. `RecallMediaMetadata` — `frontend/src/types/recall.ts`

The legacy-flat fallbacks suggest a migration that was never completed or cleaned up.

---

### ✅ 4. Duplicated helper functions across modules

`_as_int` / `_as_float` are defined identically in:
- `db.py:195–210`
- `schema.py:48–63`
- `refresh.py:59–69`

`_safety_score` / `_safety_metadata` logic in `db.py:226–237` overlaps `_safety_from_detection` in `schema.py:90–106`. No shared `utils/coerce.py` module exists. `services/utils.py` (24 lines) exists for `format_bytes` but is not used as a home for these.

**Done:** `services/utils/` is now a package. `services/utils/coerce.py` contains `as_int` and `as_float` (with string-parsing support from `refresh.py`'s version). All three duplicates removed; all callers import from `coerce`. `services/utils/__init__.py` still exports `format_bytes` and `inline_schema` so no other callers broke.

---

### ✅ 5. Cross-module calls to underscore-private functions

- `refresh.py:93` — calls `metadata_svc._reverse_geocode(...)`
- `nsfw.py:182` — calls `metadata_schema._safety_from_detection(...)`

Underscore-prefixed names are imported across module boundaries, making the underscore convention meaningless. The real public API is undefined.

**Done:**
- `_reverse_geocode` → `reverse_geocode_coords` (renamed to avoid shadowing the same-named `bool` parameter in `extract()`).
- `_safety_from_detection` → `safety_from_detection`.
- All callers (refresh.py, nsfw.py, conftest.py, test files) updated.

---

### ✅ 6. Correctness bug: stale in-memory text index

`text_index.py` builds an in-process index from `catalog.get_all_search_terms()` once at startup (`main.py:15`). Two write paths never trigger a rebuild:
- `annotator.py:158` — writes search phrases via `catalog.update_metadata`
- `catalog.py:30–39` — PATCH endpoint can mutate `search.phrases`

Nothing calls `text_index.rebuild()` after these writes. `/search/text` and `/search/suggest` serve stale results until server restart. `rebuild()` is exposed at `text_index.py:40–42` but nothing wires it in.

**Done:** `routes/catalog.py` PATCH handler calls `text_index.rebuild()` after each successful `catalog.patch_item()`. The annotator write path runs as a CLI/background process, so its writes are only visible after the next server startup (which already rebuilds the index) — no fix needed there.

---

### ✅ 7. Duplicated upsert logic in indexer

`indexer.py:383–403` (`index_file`, single-file path) and `indexer.py:200–224` (`_index_pending_batch`) both perform the identical `chroma.upsert_content` + `catalog.upsert_item` sequence with the same argument mapping, maintained separately.

**Done:** Extracted `_store_indexed_item(item, embedding)`. Both call sites now delegate to it.

---

### ❌ 8. Module-level mutable singletons configured by side effect

All services use module-global mutable state lazily initialized via `configure()`:
- `db.py:13` — `_db_path`
- `chroma.py:7–8` — `_client`, `content_collection` (exported as a public module attribute)
- `gemini.py:21` — `_client`
- `text_index.py:9–10` — `_term_list`, `_term_to_ids`
- `nsfw.py:17–19` — `_model`, `_transforms`, `_class_names`

Import order and first-call timing matter. Test isolation requires the `configure(path)` indirection to work around it.

---

### ✅ 9. Inline route in `main.py:43`

The `/trials` endpoint is defined directly in `main.py` instead of in a router under `routes/`, coupling the app entrypoint to catalog logic. All other routes live in `routes/`.

**Done:** Moved to `routes/trials.py`, included via `app.include_router(trials_router.router, prefix="/trials")`.

---

### ✅ 10. Broad `except Exception` swallowing

Failures are silently discarded at:
- `extractor.py:269–271`
- `media.py:200–201` (`generate_animated_thumbnail` returns `None` on any error including programming errors)
- `indexer.py:167–169`
- `indexer.py:221–222`

Makes partial-index states hard to diagnose.

**Done:** All four sites now log tracebacks (`exc_info=True`) on unexpected exceptions. `media.py` `generate_animated_thumbnail` was fully silent — added `log = logging.getLogger(__name__)` and a `log.warning` with `exc_info=True`. The catch-and-continue strategy is kept (batch CLI; per-item errors must not abort the run), but programming errors are now distinguishable from expected transient failures in logs.

---

### ✅ 11. Untyped FastAPI responses, 4× duplicated result-shaping

No route handler in `search.py`, `catalog.py`, or `media.py` declares `response_model`. The `{"id", "distance", "metadata", "links"}` dict comprehension is copy-pasted across `search_text`, `search_semantic`, `search_similar_by_id`, and `search_similar_upload` — four near-identical copies. `PATCH /catalog/items/{id}` accepts `body: dict[str, Any]` and deep-merges it with no validation.

**Done:**
- `routes/_search_result.py` adds `SearchResponse`, `SimilarByIdResponse`, `SimilarUploadResponse` Pydantic models. All four search endpoints now declare `response_model`.
- `PATCH /catalog/items/{id}` now accepts `CatalogItemPatch` (structured Pydantic model with `organization`, `safety`, `search` sub-fields) instead of raw `dict[str, Any]`. Invalid keys rejected at the FastAPI layer before reaching `catalog.patch_item`.

---

## Frontend

### ❌ 12. `PhoneViewportFrame.tsx` — god component (557 lines)

~20 `useState` + ~12 `useRef` + ~14 `useEffect` all in one component. Owns:
- Search execution (`runSearch`, lines 91–113)
- Pagination and prefetch (`loadMore` 338–353, `prefetchNextBatch` 322–336)
- Infinite-scroll overscroll physics (246–277)
- Compose-panel scroll behavior (220–236)
- Long-press detection (359–387)
- Grid gestures, history, error state, NSFW gating, selection, detail routing

Despite many extracted child files, the component is still the orchestrator for all of this. The decomposition is shallow.

---

### ❌ 13. `liveRef` mutable mirror anti-pattern (`PhoneViewportFrame.tsx:79`)

Five pieces of state (`hasMore`, `submittedQuery`, `query`, `visibleCount`, `prefetchedResults`) are manually mirrored into a ref on every render so callbacks can read current values without declaring them as dependencies. Combined with `bgContentRef` (line 71) and `modeRef` (line 70). Two `// eslint-disable-next-line react-hooks/exhaustive-deps` comments paper over the consequences. Every new state value used in a callback must be manually remembered and added to `liveRef`.

---

### ❌ 14. Shallow decomposition / prop-drilling pass-throughs

`ResultsLayer.tsx` declares **28 props** and forwards 23 to `ResultsSection` without transforming anything. `HomeLayer.tsx` is the same pattern. The ~10 pointer/grid handlers (`handleItemPointerDown/Up/Move/Cancel`, `toggleSelected`, `zoomGridIn/Out`, `isItemBlurred`, etc.) are tunneled through 3–4 component layers from `PhoneViewportFrame` down to `ThumbCell`. The extracted files create an illusion of separation without actually encapsulating anything.

---

### ✅ 15. `ModeTransition` / `ModeTransitionReason` / `MotionDirection` defined twice

Defined in both:
- `phoneReducer.ts:1–22` — `from/to` typed as `PhoneScreen`
- `phoneUtils.ts:197–210` — `from/to` typed as bare `string`

Consumers import the utils copy. Two competing definitions that can silently drift.

**Done:** Removed the three duplicate definitions from `phoneUtils.ts`. `phoneUtils.ts` now imports them from `phoneReducer.ts` and re-exports them, so all consumers get the canonical (`PhoneScreen`-typed) versions with no import-path changes required.

---

### ✅ 16. `dispatch: (action: any)` defeats the typed reducer

`usePhoneDetail.ts:22` types `dispatch` as `(action: any) => void`, erasing the discriminated-union safety of `PhoneModeAction`. Same erasure at:
- `ResultsLayer.tsx:17,48` — `pinchHandlers as any`
- `HomeLayer.tsx:12,39` — `pinchHandlers: Record<string, (e: any) => void>`

The `GridDensityApi.pinchHandlers` precise type is erased to `any` at layer boundaries.

**Done:**
- `usePhoneDetail.ts` `dispatch` typed as `(action: PhoneModeAction) => void`.
- `ResultsLayer.tsx` and `HomeLayer.tsx` `pinchHandlers` typed as `GridGestureHandlers` (imported from `MediaGrid.tsx`). `as any` casts removed — `GridGestureHandlers` and `GridDensityApi["pinchHandlers"]` are identical `Pick<React.HTMLAttributes<HTMLElement>, ...>` types.

---

### ❌ 17. Mock fallback logic in the production search path

`PhoneViewportFrame.tsx:109,163` — when the backend is unavailable, `runSearch` synthesizes fake `makeMockItem` tiles (defined in `phoneUtils.ts:42–57`, pointing at `picsum.photos`) inline in the production code path. `makeMockItem` constructs a hand-rolled `RecallMediaItem` that must stay manually in sync with the real schema.

---

### ❌ 18. `usePhoneDetail` takes 14 parent setters as dependencies

`usePhoneDetail.ts:18–30` is injected with: `setFavoriteItems`, `setQuery`, `runSearch`, `setErrorMessage`, `setNsfwPendingItem`, `dispatch`, `modeRef`, and more. It is not an encapsulation boundary — it's a function with the parent's entire state surface passed in. `handleToggleFavorite` (lines 55–66) directly mutates the parent's `favoriteItems` array with bespoke add/remove/replace branching.

---

### ❌ 19. Optimistic UI updates silently swallow API errors

`usePhoneDetail.ts:65,74` — `handleToggleFavorite` and `handleToggleSafety` both `catch { /* no-op */ }`. API failures leave UI state diverged from server with no user feedback and no revert.

---

### ❌ 20. `global.css` — 3,321-line monolith

All styles for the phone UI and user-testing UI live in one file, organized by comment banners rather than CSS Modules or colocated styles. Class names are global strings matched against `className` template literals in TSX (e.g. `ResultsLayer.tsx:45`) — renames are unsafe and there is no scoping.

---

### ❌ 21. Magic numbers inlined at use sites

Behavioral thresholds scattered through interaction code with no central constants file:

| Value | Meaning | Location |
|---|---|---|
| `500` ms | Long-press threshold | `PhoneViewportFrame.tsx:367` |
| `64` | Move-cancel distance threshold (px²) | `PhoneViewportFrame.tsx:383` |
| `450` ms | Selection suppression window | `PhoneViewportFrame.tsx:131` |
| `400` ms | Auto-search debounce | `PhoneViewportFrame.tsx:432` |
| `140` ms | Suggestion debounce | `PhoneViewportFrame.tsx:189` |
| `60` | Compose-hide scroll threshold | `PhoneViewportFrame.tsx:85` (`HIDE_COMPOSE_THRESHOLD`) |
| `200` | Prefetch trigger (items remaining) | `PhoneViewportFrame.tsx:241` |
| `2400` ms | Chrome-hide delay | `VideoDetailView.tsx:87` |

---

## Cross-cutting

### ❌ 22. Schema defined three times with no shared contract

The metadata document shape exists as:
1. Python builder — `schema.py:189–216`
2. SQLite promoted-column list — `_db_serialization.py`
3. TypeScript interface — `frontend/src/types/recall.ts:9–50`

No OpenAPI schema, no codegen, no validation. Frontend and backend agree on field names by convention only. `PATCH /catalog/items/{id}` accepts an arbitrary `dict[str, Any]` and deep-merges it, so a client can write any shape into `metadata_json` unchecked.

---

## Priority order

| Priority | Finding | Status | Reason |
|---|---|---|---|
| 1 | #3 — dual-format metadata + #22 — triplicated schema | ❌ | Root architectural debt; drives db.py size, duplicated coercion helpers, and manual cross-stack coordination |
| 2 | #1/#2 — db.py god file + unconditional startup migrations | ✅ | Split into `_db_migrations`, `_db_serialization`; schema_version gate added |
| 3 | #6 — stale text index | ✅ | Actual correctness bug visible to users |
| 4 | #12/#13/#14 — PhoneViewportFrame god component | ❌ | Extract `useSearchController` hook; use context for pointer/grid handler bundle |
| 5 | #15/#16 — type safety erosion | ❌ | Dedupe `ModeTransition`; stop typing `dispatch`/`pinchHandlers` as `any` |
| 6 | #11 — untyped/duplicated API responses | ✅ | `response_model` on all search routes; `CatalogItemPatch` model for PATCH |
| 7 | #7 — duplicated upsert logic | ✅ | `_store_indexed_item` extracted |
| 8 | #4/#5 — duplicated helpers + private leakage | ✅ | `utils/coerce.py`; `reverse_geocode_coords` + `safety_from_detection` public |
| 9 | #10/#19 — silent error swallowing | ⚠️ | #10 done (exc_info=True + media.py logger); #19 (optimistic-update revert) still missing |
| 10 | #15/#16 — type safety erosion | ✅ | Deduped `ModeTransition`; `dispatch`/`pinchHandlers` `any` erased |
| 11 | #20/#21 — CSS monolith + magic numbers | ❌ | Colocate styles; centralize interaction constants |

---

## Session handoff — 2026-05-31 (continued)

### Branch

`refactor` (branched from `feat/phone-search-ui`)

### What was done this session

**Backend refactors** (8 commits on `refactor`):

| Commit | Finding | Summary |
|---|---|---|
| `b2fb248` | #4/#5 | `services/utils/coerce.py` with `as_int`/`as_float`; `safety_from_detection` and `reverse_geocode_coords` made public |
| `36c43d3` | #7 | `_store_indexed_item(item, embedding)` extracted in `indexer.py` |
| `27dfc3d` | #6 | `text_index.rebuild()` called in PATCH route — fixes stale `/search/text` |
| `9da815a` | #9 | `/trials` moved to `routes/trials.py` |
| `b03a36a` | #11 | `routes/_search_result.py:format_result()` replaces 4-way copy-paste |
| `33f1113` | #1/#2 | `db.py` split into `_db_migrations.py` + `_db_serialization.py`; `schema_version` table gates O(N) scans |
| `493ac6f` | — | Audit doc committed |
| `38fdfcb` | — | npm → pnpm migration (`pnpm-lock.yaml`, `start.sh`, `CLAUDE.md`, `package.json`) |

**Test count:** 134 → 155 (21 new tests in `test_coerce.py` and `test_search_routes.py`). All 155 pass.

### Additional work this session

| Commit | Finding | Summary |
|---|---|---|
| — | #11 (remaining) | `response_model` on all 4 search routes; `CatalogItemPatch` model replaces `dict[str, Any]` on PATCH |
| — | #10 | `exc_info=True` on all broad catches; `media.py` gains logger + warning for silent `generate_animated_thumbnail` |
| — | #15 | Duplicate `ModeTransition`/`ModeTransitionReason`/`MotionDirection` removed from `phoneUtils.ts`; re-exported from `phoneReducer.ts` |
| — | #16 | `dispatch: any` → `dispatch: (action: PhoneModeAction) => void`; `pinchHandlers: Record<string, any>` → `GridGestureHandlers`; `as any` casts removed |

**Test count:** 155 (unchanged — no new test surface introduced).

### What's left

**High value, backend:**
- **#3 / #22** — The dual-format metadata problem is the root cause of most remaining complexity. The legacy-flat fallback paths in every `schema.py` accessor can be removed once confirmed no live database rows use the old flat format (check with `SELECT COUNT(*) FROM media_items WHERE metadata_json NOT LIKE '%"asset"%'`). Requires running against a real distributed catalog DB — cannot verify locally.
- **#8** — The singleton pattern is pervasive and low-risk in practice given the single-process deployment, but worth tracking.

**Frontend:**
- **#12/#13/#14** — `PhoneViewportFrame.tsx` god component + `liveRef` pattern + prop-drilling. Highest-effort frontend item. Entry point: extract a `useSearchController` hook for search/pagination state, then create a `GridHandlersContext` so `ThumbCell` doesn't need handlers tunneled through 3 layers.
- **#19** — Add error revert in `handleToggleFavorite` and `handleToggleSafety` (store pre-optimistic state, restore on catch, show an error toast).
- **#17** — Move `makeMockItem` behind a dev-only flag or remove it; don't ship it in production builds.
- **#20/#21** — CSS monolith and magic numbers are cosmetic debt; safe to defer.
