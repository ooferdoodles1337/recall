# Architecture Audit

Audit of spaghetti code and bad architectural patterns across the codebase. Issues are grouped by area and ranked by impact at the bottom.

---

## Backend

### 1. `catalog/db.py` — god file (813 lines)

Four distinct concerns in one module with no separation of responsibilities:
- Schema/migration runtime (`_init_schema`, `_ensure_promoted_columns`, `_migrate_embedding_mime_types`, `_backfill_*`) — lines 85–371
- Metadata parsing helpers (`_safety_score`, `_safety_metadata`, `_location_metadata`, etc.) — lines 195–311
- CRUD/query API (`upsert_item`, `get_item`, `list_library_items`, `patch_item`, etc.)
- Row serialization (`_row_to_item`, `_row_to_summary_item`, `_row_to_stored_item`)

Should be split into at minimum: `repository.py`, `migrations.py`, `serialization.py`.

---

### 2. Unconditional O(N) startup migrations (`db.py:133–136, 328–370`)

`_migrate_embedding_mime_types` and `_backfill_embedding_mime_type_in_json` do full-table scans on **every** `configure()` call — which runs on every FastAPI startup, every CLI script invocation, and in every test. A `SCHEMA_VERSION` constant exists in `schema.py:8` but there is no `schema_version` table and no short-circuit guard. These always run regardless of whether any migration is needed, making startup cost O(N) in library size.

---

### 3. Dual-format metadata abstraction (deepest architectural problem)

Metadata exists in three forms simultaneously that must be kept in sync manually:
- Structured nested dict (`asset` / `capture` / `search` / `safety` / `organization` / `system`)
- Promoted SQLite columns (`_PROMOTED_COLUMN_DEFS`, `db.py:15`)
- Legacy flat dict (fallback paths in every accessor)

Every accessor in `schema.py:394–501` has dual-read fallbacks (new format → flat fallback). `schema.py` constantly round-trips between representations via `build_metadata`, `rebuild_metadata`, `_flat_extra_from_existing`, and `merge_metadata`.

Adding a single field requires coordinated edits to six places with no compiler help:
1. `_PROMOTED_COLUMN_DEFS` — `db.py:15`
2. `_PROMOTED_METADATA_KEYS` — `schema.py:14`
3. `build_metadata` — `schema.py`
4. `_promoted_values` — `db.py:258–294`
5. `_row_to_summary_item` — `db.py:438–510`
6. `RecallMediaMetadata` — `frontend/src/types/recall.ts`

The legacy-flat fallbacks suggest a migration that was never completed or cleaned up.

---

### 4. Duplicated helper functions across modules

`_as_int` / `_as_float` are defined identically in:
- `db.py:195–210`
- `schema.py:48–63`
- `refresh.py:59–69`

`_safety_score` / `_safety_metadata` logic in `db.py:226–237` overlaps `_safety_from_detection` in `schema.py:90–106`. No shared `utils/coerce.py` module exists. `services/utils.py` (24 lines) exists for `format_bytes` but is not used as a home for these.

---

### 5. Cross-module calls to underscore-private functions

- `refresh.py:93` — calls `metadata_svc._reverse_geocode(...)`
- `nsfw.py:182` — calls `metadata_schema._safety_from_detection(...)`

Underscore-prefixed names are imported across module boundaries, making the underscore convention meaningless. The real public API is undefined.

---

### 6. Correctness bug: stale in-memory text index

`text_index.py` builds an in-process index from `catalog.get_all_search_terms()` once at startup (`main.py:15`). Two write paths never trigger a rebuild:
- `annotator.py:158` — writes search phrases via `catalog.update_metadata`
- `catalog.py:30–39` — PATCH endpoint can mutate `search.phrases`

Nothing calls `text_index.rebuild()` after these writes. `/search/text` and `/search/suggest` serve stale results until server restart. `rebuild()` is exposed at `text_index.py:40–42` but nothing wires it in.

---

### 7. Duplicated upsert logic in indexer

`indexer.py:383–403` (`index_file`, single-file path) and `indexer.py:200–224` (`_index_pending_batch`) both perform the identical `chroma.upsert_content` + `catalog.upsert_item` sequence with the same argument mapping, maintained separately.

---

### 8. Module-level mutable singletons configured by side effect

All services use module-global mutable state lazily initialized via `configure()`:
- `db.py:13` — `_db_path`
- `chroma.py:7–8` — `_client`, `content_collection` (exported as a public module attribute)
- `gemini.py:21` — `_client`
- `text_index.py:9–10` — `_term_list`, `_term_to_ids`
- `nsfw.py:17–19` — `_model`, `_transforms`, `_class_names`

Import order and first-call timing matter. Test isolation requires the `configure(path)` indirection to work around it.

---

### 9. Inline route in `main.py:43`

The `/trials` endpoint is defined directly in `main.py` instead of in a router under `routes/`, coupling the app entrypoint to catalog logic. All other routes live in `routes/`.

---

### 10. Broad `except Exception` swallowing

Failures are silently discarded at:
- `extractor.py:269–271`
- `media.py:200–201` (`generate_animated_thumbnail` returns `None` on any error including programming errors)
- `indexer.py:167–169`
- `indexer.py:221–222`

Makes partial-index states hard to diagnose.

---

### 11. Untyped FastAPI responses, 4× duplicated result-shaping

No route handler in `search.py`, `catalog.py`, or `media.py` declares `response_model`. The `{"id", "distance", "metadata", "links"}` dict comprehension is copy-pasted across `search_text`, `search_semantic`, `search_similar_by_id`, and `search_similar_upload` — four near-identical copies. `PATCH /catalog/items/{id}` accepts `body: dict[str, Any]` and deep-merges it with no validation.

---

## Frontend

### 12. `PhoneViewportFrame.tsx` — god component (557 lines)

~20 `useState` + ~12 `useRef` + ~14 `useEffect` all in one component. Owns:
- Search execution (`runSearch`, lines 91–113)
- Pagination and prefetch (`loadMore` 338–353, `prefetchNextBatch` 322–336)
- Infinite-scroll overscroll physics (246–277)
- Compose-panel scroll behavior (220–236)
- Long-press detection (359–387)
- Grid gestures, history, error state, NSFW gating, selection, detail routing

Despite many extracted child files, the component is still the orchestrator for all of this. The decomposition is shallow.

---

### 13. `liveRef` mutable mirror anti-pattern (`PhoneViewportFrame.tsx:79`)

Five pieces of state (`hasMore`, `submittedQuery`, `query`, `visibleCount`, `prefetchedResults`) are manually mirrored into a ref on every render so callbacks can read current values without declaring them as dependencies. Combined with `bgContentRef` (line 71) and `modeRef` (line 70). Two `// eslint-disable-next-line react-hooks/exhaustive-deps` comments paper over the consequences. Every new state value used in a callback must be manually remembered and added to `liveRef`.

---

### 14. Shallow decomposition / prop-drilling pass-throughs

`ResultsLayer.tsx` declares **28 props** and forwards 23 to `ResultsSection` without transforming anything. `HomeLayer.tsx` is the same pattern. The ~10 pointer/grid handlers (`handleItemPointerDown/Up/Move/Cancel`, `toggleSelected`, `zoomGridIn/Out`, `isItemBlurred`, etc.) are tunneled through 3–4 component layers from `PhoneViewportFrame` down to `ThumbCell`. The extracted files create an illusion of separation without actually encapsulating anything.

---

### 15. `ModeTransition` / `ModeTransitionReason` / `MotionDirection` defined twice

Defined in both:
- `phoneReducer.ts:1–22` — `from/to` typed as `PhoneScreen`
- `phoneUtils.ts:197–210` — `from/to` typed as bare `string`

Consumers import the utils copy. Two competing definitions that can silently drift.

---

### 16. `dispatch: (action: any)` defeats the typed reducer

`usePhoneDetail.ts:22` types `dispatch` as `(action: any) => void`, erasing the discriminated-union safety of `PhoneModeAction`. Same erasure at:
- `ResultsLayer.tsx:17,48` — `pinchHandlers as any`
- `HomeLayer.tsx:12,39` — `pinchHandlers: Record<string, (e: any) => void>`

The `GridDensityApi.pinchHandlers` precise type is erased to `any` at layer boundaries.

---

### 17. Mock fallback logic in the production search path

`PhoneViewportFrame.tsx:109,163` — when the backend is unavailable, `runSearch` synthesizes fake `makeMockItem` tiles (defined in `phoneUtils.ts:42–57`, pointing at `picsum.photos`) inline in the production code path. `makeMockItem` constructs a hand-rolled `RecallMediaItem` that must stay manually in sync with the real schema.

---

### 18. `usePhoneDetail` takes 14 parent setters as dependencies

`usePhoneDetail.ts:18–30` is injected with: `setFavoriteItems`, `setQuery`, `runSearch`, `setErrorMessage`, `setNsfwPendingItem`, `dispatch`, `modeRef`, and more. It is not an encapsulation boundary — it's a function with the parent's entire state surface passed in. `handleToggleFavorite` (lines 55–66) directly mutates the parent's `favoriteItems` array with bespoke add/remove/replace branching.

---

### 19. Optimistic UI updates silently swallow API errors

`usePhoneDetail.ts:65,74` — `handleToggleFavorite` and `handleToggleSafety` both `catch { /* no-op */ }`. API failures leave UI state diverged from server with no user feedback and no revert.

---

### 20. `global.css` — 3,321-line monolith

All styles for the phone UI and user-testing UI live in one file, organized by comment banners rather than CSS Modules or colocated styles. Class names are global strings matched against `className` template literals in TSX (e.g. `ResultsLayer.tsx:45`) — renames are unsafe and there is no scoping.

---

### 21. Magic numbers inlined at use sites

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

### 22. Schema defined three times with no shared contract

The metadata document shape exists as:
1. Python builder — `schema.py:189–216`
2. SQLite promoted-column list — `db.py:15–44`
3. TypeScript interface — `frontend/src/types/recall.ts:9–50`

No OpenAPI schema, no codegen, no validation. Frontend and backend agree on field names by convention only. `PATCH /catalog/items/{id}` accepts an arbitrary `dict[str, Any]` and deep-merges it, so a client can write any shape into `metadata_json` unchecked.

---

## Priority order

| Priority | Finding | Reason |
|---|---|---|
| 1 | #3 — dual-format metadata + #22 — triplicated schema | Root architectural debt; drives db.py size, duplicated coercion helpers, and manual cross-stack coordination |
| 2 | #1/#2 — db.py god file + unconditional startup migrations | Split into `repository`, `migrations`, `serialization`; add version gate |
| 3 | #6 — stale text index | Actual correctness bug visible to users |
| 4 | #12/#13/#14 — PhoneViewportFrame god component | Extract `useSearchController` hook; use context for pointer/grid handler bundle |
| 5 | #15/#16 — type safety erosion | Dedupe `ModeTransition`; stop typing `dispatch`/`pinchHandlers` as `any` |
| 6 | #11 — untyped/duplicated API responses | Add `response_model`; extract shared result-shaping helper |
| 7 | #7 — duplicated upsert logic | Extract shared `_upsert_item` helper in indexer |
| 8 | #4/#5 — duplicated helpers + private leakage | Consolidate into `utils/coerce.py`; expose as proper public API |
| 9 | #10/#19 — silent error swallowing | Add error feedback / revert for optimistic updates |
| 10 | #20/#21 — CSS monolith + magic numbers | Colocate styles; centralize interaction constants |
