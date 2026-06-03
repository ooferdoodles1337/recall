# Recall App UX Trace for Desktop Rewrite

Generated: 2026-06-02

Purpose: systematically map the current Recall prototype from a UX perspective so it can be rewritten as a real desktop application instead of a user-testing demo.

This document traces the live frontend routes, phone UI state machine, all visible screens and overlays, user interactions, backend-supported product capabilities, prototype-only scaffolding, and rewrite implications. It is based on a local code trace plus three focused subagent traces:

- `/phone` UX, reducer, components, CSS, and tests.
- `/` desktop user-testing harness and study flow.
- Backend/API/media/catalog/search capabilities and constraints.

Primary source files:

- `docs/ux-spec.md`
- `frontend/src/app/App.tsx`
- `frontend/src/features/phone/**`
- `frontend/src/features/user-testing/**`
- `frontend/src/styles/phone.css`
- `frontend/src/styles/user-testing.css`
- `frontend/tests/unit/**`
- `backend/main.py`
- `backend/routes/**`
- `backend/services/catalog/**`
- `backend/services/search/**`
- `backend/services/pipeline/**`

## 1. Product Shape Today

Recall is currently two related experiences sharing the same backend:

1. `/phone`: the primary product-like prototype. It presents an iOS-style media search interface inside a fullscreen phone viewport. It supports recent/favorite browsing, semantic result search, autocomplete, search history, detail views, similar search, same-date browsing, video playback, favorites, NSFW reveal, mock settings, mock indexed albums, and selection/confirm flows.
2. `/`: a user-testing harness. It is not a real desktop product. It lets participants start timed sessions, uses the phone UI as the task surface, records elapsed time locally, and shows simple session results.

The backend is richer than the UI currently exposes. It supports catalog browsing, facets, stats, item detail, item patching, media serving, search by semantic embedding, search by exact/prefix/fuzzy phrases, suggestions, similar-by-ID, similar-by-upload, and random trial targets.

The future desktop app should not simply enlarge the phone UI. It should preserve the proven product behaviors, separate them from user-testing artifacts, and redesign the information architecture around desktop workflows: persistent library navigation, search and filters, scalable grids, preview/detail inspector, media operations, import/indexing status, and explicit content-safety policy.

## 2. Current Route Map

### 2.1 Routing Rules

Source: `frontend/src/app/App.tsx`

- Routing is a direct `window.location.pathname` check.
- Any path beginning with `/phone` renders the phone UI.
- Every other path renders the user-testing harness.
- There is no React Router, no URL-deep-linked search state, and no route-level loading UI because `Suspense fallback={null}` is used.
- One `QueryClient` wraps both routes with `staleTime: 30_000` and `retry: false`.

Rewrite implication:

- Replace path sniffing with explicit app routes or desktop-native navigation state.
- Add route/load fallbacks or app-shell skeletons.
- Decide which states deserve URLs, history entries, or native window restoration.

### 2.2 Live Routes

| Route | Current surface | Purpose today | Product value for rewrite |
| --- | --- | --- | --- |
| `/` | `UserTestingWebUI` | Study wrapper and trial timer | Mostly prototype-only; may become a separate research/admin mode |
| `/phone` | `PhoneTesterUI` -> `PhoneViewportFrame` | Product-like photo search prototype | Main source of UX behavior and interaction requirements |

## 3. Conceptual UX Model

These are the durable concepts hidden in the prototype:

- Library item: a media asset with UUID, metadata, media/thumbnail links, safety state, favorite state, capture date/location, dimensions, and optional duration.
- Library surfaces: home/recent items, favorites, search results, date-browse result set, similar-search result set.
- Search query: free-text natural-language query resolved through the semantic result endpoint.
- Search suggestions: remote catalog-derived terms plus local history matches.
- Search history: local recent queries, separate from backend data.
- Result set: ordered media grid from semantic results only. Text-index matches are not merged into the result grid.
- Detail item: the current item opened from a source grid, with source-relative previous/next navigation.
- Sensitive reveal session: in-memory reveal of one item or all NSFW items for the current session.
- Selection set: ordered list of selected items used by the user-testing `Send` or `Confirm` affordance.
- Grid density: persistent column count preference, currently 1-6 columns.
- Date browse context: catalog date-prefix query displayed as a search bar chip.
- Similar-search source: an item whose embedding is reused to search neighbors, displayed as a chip.
- Mock indexed albums: local-only album scope setting with no backend effect.
- Trial session: local timed task records for user testing.

## 4. Desktop Harness at `/`

The `/` route is not a desktop app. It is a timed study shell around the phone prototype.

### 4.1 Harness State

Source: `frontend/src/features/user-testing/UserTestingWebUI.tsx`

Live state machine:

| State | Screen | Entry | Exit |
| --- | --- | --- | --- |
| `welcome` | Welcome screen | Initial route or `Start Over` | `Start Trial` -> `task` |
| `task` | Trial lobby or active phone task | `Start Trial` from welcome | `Finish Session` -> `results` |
| `results` | Session results | Finish session from task | `Start Over` -> `welcome` |

There is an `InstructionsScreen`, but it is not wired into the live state machine.

### 4.2 Welcome Screen

Source: `frontend/src/features/user-testing/screens/WelcomeScreen.tsx`

Visible elements:

- Eyebrow: `Recall`
- Title: `User Testing Session`
- Primary action: `Start Trial`
- Secondary action: `Open Phone Tester`

Interactions:

- `Start Trial` sets the harness screen to `task`.
- `Open Phone Tester` links to `/phone`.

Rewrite implication:

- This is study framing, not product onboarding.
- A real desktop app should land on the usable library/search workspace, not on a study launcher.

### 4.3 Task Lobby

Source: `frontend/src/features/user-testing/screens/TaskScreen.tsx`

State:

- Internal `phase` is `idle | active`.
- Results are loaded from `localStorage` key `recall.trialResults.v1`.
- `startMsRef` stores the timestamp for the active trial.

Visible idle/lobby elements:

- Eyebrow: `Recall - User Study`
- Heading: `Ready when you are.` when no results exist.
- Heading: `Trial complete.` when one or more results exist.
- Explanatory paragraph.
- Button: `Start Trial` or `Start Next Trial`.
- Button: `Finish Session` when results exist.
- Trial times card.
- Trial count badge when results exist.
- Trash button to clear trial times.
- Empty text: `No trials yet - press Start to begin.`
- Best badge only when there are two or more trials.
- Average row only when there are two or more trials.

Interactions:

- `Start Trial`:
  - Sets `isStarting`.
  - Stores `Date.now()` in `startMsRef`.
  - Moves `phase` to `active`.
- `Finish Session`:
  - Passes current `results` up to `UserTestingWebUI`.
  - Moves harness to `results`.
- Trash:
  - Removes `recall.trialResults.v1`.
  - Clears in-memory results.

Observed behavior gap:

- `Start Over` on the results screen clears only in-memory `sessionResults`, not persisted `localStorage`. When the task screen remounts, it reloads persisted trial history.

Rewrite implication:

- Either remove study persistence from the product or define explicit persistence semantics.
- If a research mode remains, it needs correct reset behavior, participant/session IDs, target validation, and export/submission.

### 4.4 Active Trial

Source: `frontend/src/features/user-testing/screens/TaskScreen.tsx`

Active state renders:

- Fullscreen `PhoneViewportFrame`.
- `onConfirmAnswer={handleConfirm}`.
- `onExit={handleAbandon}`.

Interactions:

- Confirming from the phone UI records a trial result.
- Exiting the phone UI abandons the trial, clears the timer, records nothing, and returns to the idle lobby.

Recorded result shape:

- `trialNumber`
- `targetId`
- `selectedId`
- `elapsedMs`
- `timestamp`

Current limitations:

- `targetId` is hardcoded to `"free"`.
- There is no visible target image in the active trial.
- Correctness is not validated.
- Results are only stored locally and logged to the console.
- Dormant modules exist for target photos, trials API, session metrics, and result sinks, but they are not wired into the live flow.

Prototype-only affordances introduced into the phone UI:

- `Send` from selection tray can confirm the first selected item.
- Detail view uses `Confirm` instead of `Send` when `onConfirmAnswer` is provided.
- `currentTarget`, `onSelectCandidate`, and `onConfirmAnswer` are task harness integration points rather than core product concepts.

### 4.5 Session Results

Source: `frontend/src/features/user-testing/screens/ResultsScreen.tsx`

Visible elements:

- Completion badge.
- Title: `Session Complete`
- Subtitle thanking the participant.
- Trial rows with trial number and elapsed time when results exist.
- `Best` badge only for the fastest row when two or more trials exist.
- Average when two or more trials exist.
- Empty fallback metric cards when no results exist: `Done`, `Guided`, `Debrief`.
- Button: `Start Over`.

Interactions:

- `Start Over` clears `sessionResults` in `UserTestingWebUI` and returns to welcome.

Rewrite implication:

- This entire flow should be separated from the real app. It can remain as a hidden research mode or be deleted from product builds.

### 4.6 Dormant Harness Artifacts

Files:

- `frontend/src/features/user-testing/screens/InstructionsScreen.tsx`
- `frontend/src/features/user-testing/components/TargetPhotoPanel.tsx`
- `frontend/src/features/user-testing/tasks/targets.ts`
- `frontend/src/features/user-testing/api/trialsApi.ts`
- `frontend/src/features/user-testing/api/resultsSink.ts`
- `frontend/src/features/user-testing/metrics/**`
- `backend/routes/trials.py`

Dormant or partial intent:

- Instruction walkthrough.
- Target photo panel.
- Random trial target fetching.
- Session-level metrics with search and click counts.
- Results submission abstraction.

Rewrite implication:

- Decide whether this is still valuable. If not, remove it. If yes, rebuild it as a separate instrumented mode rather than blending it into normal media search.

## 5. Phone UI at `/phone`

The `/phone` route is the primary UX prototype. Its behavior is specified by `docs/ux-spec.md` and implemented mainly in `PhoneViewportFrame`, `phoneReducer`, `useSearchController`, and related components.

### 5.1 Phone UI State Model

Source: `frontend/src/features/phone/phoneReducer.ts`

Core screen states:

- `home`
- `compose`
- `results`
- `detail`

Auxiliary state:

- `bgContent`: `home | results`
- `composeStartQuery`: query value captured on compose entry, restored on dismiss.
- `transition`: `from`, `to`, `direction`, `reason`, `key`.

Depth model:

| Screen | Depth | Meaning |
| --- | ---: | --- |
| `home` | 0 | Browse starting surface |
| `compose` | 1 | Search input overlay over home or results |
| `results` | 2 | Committed search/date/similar result set |
| `detail` | 3 | Full media detail overlay |

Motion direction is derived from depth:

- Moving to a deeper state is `forward`.
- Moving to a shallower state is `back`.
- Same-screen background transitions are `neutral`.

### 5.2 Phone State Transitions

| Action | UX trigger | From | To | Background content | Notes |
| --- | --- | --- | --- | --- | --- |
| `SEARCH_FOCUS` | Search input focus or history icon opening compose | `home`, `results` | `compose` | Preserved | Stores `composeStartQuery`; no-op from `compose` or `detail` |
| `SEARCH_COMMIT` | Enter key or suggestion/history tap | Any non-detail path | `results` | `results` | Explicit search navigates, blurs input, scrolls to top |
| `AUTOSEARCH_COMMIT` | 400 ms idle autosearch while composing | `compose` over `home` | `compose` | `results` | Background changes to results; focus and panel remain |
| `SEARCH_CLEAR` | Clear query over results, Escape from non-home, reset | Any | `home` | `home` | Clears query/results and scrolls to top |
| `COMPOSE_DISMISS` | Escape, outside tap over results, scroll down over home, explicit close | `compose` | `home` or `results` | Preserved | Returns to whatever `bgContent` was under compose |
| `SIMILAR_SEARCH` | Detail action `Similar` | Any | `results` | `results` | Uses source item embedding; clears detail item |
| `DETAIL_OPEN` | Long press, sensitive reveal, or detail open call | `home`, `results`, `compose` | `detail` | Preserved | No-op from `detail` |
| `DETAIL_CLOSE` | Back button, Escape, detail close | `detail` | `home` or `results` | Preserved | Returns to source background |
| `TARGET_RESET` | User-testing target changes while in detail | `detail` | `home` | `home` | Prototype harness reset |

Desktop rewrite invariant:

- Preserve the distinction between displayed screen, background content, and source result set. Desktop will likely use panes instead of overlays, but the app still needs to know whether a detail item came from favorites, search results, date browse, or similar search.

## 6. Phone Home Screen

Primary files:

- `PhoneViewportFrame.tsx`
- `HomeLayer.tsx`
- `FavoritesSection.tsx`
- `PhoneHomeHeader.tsx`
- `MediaGrid.tsx`

### 6.1 Home Structure

Visible areas:

- Recall header with logo, title, settings avatar, and optional exit button.
- Persistent search bar.
- Favorites section when favorites are loading or available.
- Favorites grid.
- Grid zoom controls.

Data:

- Favorites are fetched via `listFavoriteItems(FAVORITES_COUNT)`.
- `FAVORITES_COUNT` is 34.
- If no favorites and not loading, the favorites section is hidden.

Header behavior:

- Header appears when home is active and scroll is at the top.
- Header animates in from above.
- Header disappears after scrolling away from the top.
- Search bar remains visible regardless of scroll.

Spec/code note:

- `docs/ux-spec.md` describes the header as in the scroll flow above the search bar. Current code renders it above the persistent search shell and toggles it based on scroll-top state. The experienced behavior is close, but the DOM placement differs.

### 6.2 Home Interactions

Search:

- Focus input -> enter `compose` over `home`.
- Empty compose over home shows history if history exists.
- Typing opens suggestions and autosearch preview.
- Emptying a new query over home does not navigate.
- Escape from compose restores the pre-compose query and returns home.
- Downward scroll while composing over home dismisses compose and blurs input.

Settings:

- Tap avatar -> open settings sheet.

Exit:

- Tap exit button -> `window.location.href = "/"` when on `/phone`.
- In active user-testing task, exit abandons the current trial.

Grid density:

- Zoom in/out buttons change column count.
- Ctrl+wheel changes density.
- Pinch gesture changes density on touch devices.
- Preference persists to `recall.phoneGridColumns.v1`.

Favorites grid tile:

- Short press on a safe item toggles selection.
- Long press on a safe item opens detail after 500 ms.
- Pointer movement beyond threshold cancels long press.
- Short press on a blurred NSFW item opens the sensitive-content sheet.
- Keyboard Enter/Space on a tile toggles selection.

Selection:

- Selecting one or more items opens the selection tray.
- Selected tiles display selection order badges.

Desktop rewrite implications:

- On desktop, a normal click should probably open detail, not select. Multi-select should use checkboxes, modifier keys, drag select, or explicit selection mode.
- Favorites should become a first-class smart collection or sidebar item, not only a home section.
- Grid density should become a desktop view option with keyboard shortcuts and per-view persistence.

## 7. Search Bar and Compose Panel

Primary files:

- `PhoneSearchShell.tsx`
- `SearchCommandLayer.tsx`
- `useSearchController.ts`
- `docs/ux-spec.md`

### 7.1 Persistent Search Bar

The search bar is a single persistent section outside the scroll viewport. It is always reachable in home, compose, and results states.

Normal text-search mode:

- History/spinner icon slot on the left when shown.
- Text input with aria-label `Search your media`.
- Placeholder: `Describe a photo or video...`
- Clear button when value is non-empty.
- Enter key submits explicit search.

Date-browse mode:

- Search bar becomes a date chip with calendar icon and label.
- Clear button exits date browse and returns home.
- No text input is rendered in this mode.

Similar-search mode:

- Search bar becomes a similar-source chip with thumbnail if available.
- Clear button exits similar search and returns home.
- Tapping the similar chip clears similar context and enters compose with history visible.

History/spinner icon rules:

- In active searching, spinner replaces the history icon and the icon button is disabled.
- In compose, history icon appears only if history exists and the current query is non-empty.
- In results, history icon appears when history exists.
- In home, history icon is hidden because empty compose already shows history.

### 7.2 Compose Panel Content

The compose panel is a glass card connected to the search bar. It is visible only when `mode === "compose"` and `showComposePanel` is true.

Content priority:

1. Empty query -> show recent search history if available.
2. Non-empty query + suggestions -> show suggestions.
3. Non-empty query + no suggestions + history -> show history fallback.
4. Non-empty query + no suggestions + no history -> show empty prompt.

Suggestion cap:

- `SearchAssistPanel` can render any number of suggestions.
- `useSearchController` passes at most 3 suggestions for compose mode.

History UI:

- Header label: `Recent`.
- Button: `Clear all`.
- Each history row has a primary button and a remove button.
- Removing a history item updates `localStorage`.
- Clearing history writes an empty history list.

Suggestion UI:

- Suggestions are buttons.
- A suggestion matching known history uses a clock icon.
- Other suggestions use a search icon.
- Tapping a suggestion commits an explicit search.

Empty prompt:

- Shows `Press Enter to search` when idle.
- Shows `Searching...` while actively searching.

Desktop rewrite implications:

- Build a real combobox or command palette pattern with keyboard navigation, active option, ARIA listbox semantics, and predictable Enter/Escape behavior.
- Keep search history and suggestions, but keep semantic result search distinct from any exact-match tooling. Do not merge text-index matches into semantic result grids.
- Consider showing suggestion provenance: recent, phrase match, semantic refinement, date, location, album.

### 7.3 Search Controller Behavior

Constants:

- Search batch size: 50.
- Suggestion debounce: 140 ms.
- Autosearch debounce: 400 ms.
- Prefetch trigger: 200 px remaining.

Explicit search:

- Trims query.
- Aborts any prior active search.
- Aborts load-more request.
- Clears similar context.
- Sets loading and clears prior results.
- Sets submitted query.
- Clears date-browse context.
- Dispatches `SEARCH_COMMIT`.
- Scrolls results to top.
- Blurs input.
- Runs semantic search only.
- Slices to requested count.
- Saves query to search history unless disabled.

Autosearch:

- Runs only in compose.
- Requires query length at least 2.
- Dispatches `AUTOSEARCH_COMMIT`.
- Does not save history.
- Does not blur input.
- Does not dismiss compose.
- Updates background results silently.

Search failure:

- If semantic search fails, dev mode creates sample mock tiles and shows:
  - `Backend unavailable. Showing sample tiles until the media bundle is indexed.`

Load more:

- Current implementation reruns semantic search with a larger `n`.
- If prefetched results are available, they are used immediately.
- Button and touch overscroll can trigger load more.

Clear/reset:

- Empty query over results:
  - Cancels autosearch.
  - Aborts active search.
  - Clears query and submitted query.
  - Clears date context and similar context.
  - Hides history.
  - Refreshes history from storage.
  - Dispatches `SEARCH_CLEAR`.
  - Blurs input.
- Clear over home compose:
  - Clears query.
  - Shows history.
  - Does not navigate.

Desktop rewrite implications:

- Current load-more strategy will not scale. Add true pagination, cursors, or stable result sessions.
- Desktop should preserve autosearch as preview, but perhaps name it "live results" and expose cancellation/loading more explicitly.
- Search history should become an app-level preference with privacy controls.

## 8. Results Screen

Primary files:

- `ResultsLayer.tsx`
- `ResultsSection.tsx`
- `MediaGrid.tsx`
- `useSearchController.ts`

### 8.1 Result Set Types

Results can come from:

- Recent catalog items when no submitted query exists.
- Explicit semantic result search.
- Autosearch preview.
- Same-date catalog browse.
- Similar-by-ID search.
- Dev fallback sample tiles.

### 8.2 Results Layout

Visible elements:

- Persistent search bar above scroll area.
- Grid toolbar with zoom controls.
- Optional error alert.
- Media grid.
- Optional results footer card.
- Optional `Show more results` button.
- Optional `Did you mean` refinement row.
- Optional pull-to-load-more indicator during touch overscroll.

Loading states:

- Initial loading shows skeleton tiles.
- Loading more shows trailing skeleton tiles.
- Search spinner occupies search bar history icon slot.
- Pull indicator shows progress and `Release!` when threshold reached.

Empty states:

- Normal search: `No results`, `Try another description.`
- Date browse: `No items found`, `No items found for this date.`

Footer states:

- `Show more results` appears when `hasMore` is true.
- Button label becomes `Loading...` while loading more.
- Refinement chips appear when suggestions differ from submitted query.
- Date browse suppresses refinement chips.

Desktop rewrite implications:

- Replace phone footer/pull-to-load with desktop pagination, infinite scroll, or result session controls.
- Add sort/filter controls to the result header.
- Add "why this matched" or metadata chips for confidence and exact phrase matches.
- Make errors actionable: backend offline, missing index, missing API key, media unavailable.

## 9. Media Grid and Tile Behavior

Primary file: `MediaGrid.tsx`

### 9.1 Tile Content

Each tile can show:

- Static thumbnail.
- Animated thumbnail overlay for animated images.
- Blurred thumbnail for NSFW item.
- NSFW overlay with hidden icon.
- Video badge with play icon and duration label.
- GIF badge.
- Selection order badge.
- Fallback placeholder when no thumbnail is available.

Accessibility:

- Grid has `role="group"` and aria-label.
- Tile is a button.
- Safe tile aria-label: `Select/Deselect {itemTitle}`.
- Blurred tile aria-label: `Sensitive content - tap to review`.
- Selected safe tile uses `aria-pressed`.

### 9.2 Tile Interactions

Safe item:

- Pointer down starts long-press timer.
- Pointer move beyond 64 px squared cancels timer.
- Pointer up before long press toggles selection.
- Long press opens detail after 500 ms.
- Context menu is suppressed.
- Enter/Space toggles selection.

Sensitive item:

- Pointer up opens NSFW bottom sheet instead of selection.
- Long press is not started.

Selection-suppression:

- Pinch gestures suppress tile selection for 450 ms.

Long-press hint:

- In results mode, after the first selection, a `Long press to view` hint may appear.
- Hint auto-dismisses after 3000 ms.
- Dismissed state persists to `recall.longPressHint.v1`.

Desktop rewrite implications:

- Long press should not be primary on desktop.
- Use click-to-open, hover/keyboard focus states, checkboxes, context menus, and modifier-key selection.
- Preserve visual badges: video duration, GIF, sensitive hidden, favorite status if added.

## 10. Grid Density

Primary file: `useGridDensity.ts`

Column options:

- 1, 2, 3, 4, 5, 6

Default:

- 3 columns

Persistence:

- `recall.phoneGridColumns.v1`

Controls:

- Zoom-in button decreases columns.
- Zoom-out button increases columns.
- Ctrl+wheel changes columns.
- Touch pinch changes columns.

Animation:

- Uses FLIP animation to animate grid item repositioning.
- Respects reduced motion.

Special behavior:

- 1-column mode uses natural aspect ratios.
- Gap and radius shrink as column count increases.

Desktop rewrite implications:

- Map this to thumbnail-size slider and view-density presets.
- Persist per view if desktop has multiple layouts.
- Provide keyboard shortcuts and menu items.

## 11. Selection Tray

Primary files:

- `useSelectionTray.ts`
- `SelectionTray.tsx`
- `PhoneViewportFrame.tsx`

Visible when:

- One or more items are selected.
- Current mode is not `detail`.
- Current mode is not `compose`.

Content:

- Row of selected thumbnails.
- Remove affordance on each selected thumbnail.
- Badge: `{n} selected`.
- Button: `Send`.

Interactions:

- Tap selected thumbnail -> remove it from selection.
- Tap `Send`:
  - If `onConfirmAnswer` exists, confirm the first selected item.
  - Clear selection.
- Escape behavior documented in the spec says the tray is dismissed by Escape, but current top-level Escape from non-home resets search; tray-specific Escape handling is not obvious in current code.

Prototype vs product:

- Current tray exists primarily to submit a trial answer.
- It could become a real desktop multi-select action bar, but the actions need to change.

Desktop rewrite implications:

- Replace `Send` with product actions: open, compare, favorite, mark safe/NSFW, reveal/hide, export/share, delete/remove from collection, add to album.
- Support range selection and keyboard selection.
- Avoid using the first selected item as an implicit answer outside research mode.

## 12. Detail View

Primary files:

- `usePhoneDetail.ts`
- `DetailViewChrome.tsx`
- `ImageDetailView.tsx`
- `VideoDetailView.tsx`
- `SensitiveDetailPrompt.tsx`

### 12.1 Detail Entry and Source

Safe item:

- Long press opens detail.
- In testing mode, opening detail calls `onSelectCandidate`.

Sensitive item:

- Opening from grid first shows the NSFW bottom sheet.
- Choosing `View` reveals that item and opens detail.

Source grid:

- Detail navigation uses the grid that opened detail.
- From home/favorites: navigate through current favorites.
- From results: navigate through current results.

### 12.2 Detail Layout

Detail is a fullscreen overlay with:

- Backdrop.
- Media rail containing previous/current/next preview positions.
- Current media.
- Top floating chrome.
- Optional side navigation buttons.
- Optional bottom action row.
- Optional sensitive interstitial.

Top chrome:

- Back button.
- Date badge if date metadata exists.
- Favorite toggle when not hidden.
- More actions menu when not hidden.

More actions:

- `Mark as Safe` when item is NSFW.
- `Mark as NSFW` when item is not NSFW.
- `About`.

Bottom action row:

- `Same Date`.
- `Similar`.
- `Send` in free phone mode.
- `Confirm` in user-testing mode.

### 12.3 Detail Navigation

Controls:

- Horizontal pointer drag.
- Horizontal touch swipe.
- Side previous/next buttons.
- Keyboard ArrowLeft and ArrowRight.

Rules:

- Swipe left advances to next item.
- Swipe right returns to previous item.
- At source boundaries, the swipe is constrained and does not navigate.
- Buttons, menus, inputs, textareas, selects, and menu items do not initiate swipe navigation.
- Detail-to-detail transitions slide horizontally.
- Regular open/close uses fade/shared-media motion.

Sensitive neighbor behavior:

- Swiping to an NSFW item does not skip it.
- It lands on the item with media blurred.
- It shows centered `Sensitive Content` prompt.
- `View` reveals only that item for the session.
- Back and navigation remain available.

### 12.4 Favorite Mutation

Source: `usePhoneDetail.ts`

Interaction:

- Tap star button.

Backend call:

- `PATCH /catalog/items/{id}` with `{ organization: { favorite } }`.

Success:

- Updates detail item.
- Updates about sheet item.
- Updates cached catalog results.
- Invalidates favorites query.

Failure:

- Sets error message: `Couldn't update favorite - please try again.`

Desktop rewrite implications:

- Favorite should be immediate and optimistic if possible.
- Add clear feedback for failures.
- Decide whether favorite changes affect current result filters immediately.

### 12.5 Safety Mutation

Interaction:

- More menu -> `Mark as NSFW` or `Mark as Safe`.

Backend call:

- `PATCH /catalog/items/{id}` with `{ safety: { state } }`.

Success:

- Updates item in detail/results/favorites.
- If marked safe, reveals it and clears pending NSFW dialog.

Failure:

- Sets error message: `Couldn't update content rating - please try again.`

Desktop rewrite implications:

- Decide whether safety marking is a user preference, local metadata edit, moderation action, or review workflow.
- Today media URLs remain accessible even if item is NSFW. Production may need server-side gating or safe-search filtering.

### 12.6 Same-Date Search

Interaction:

- Detail action `Same Date`.

Behavior:

- Extracts date prefix from `capture.sort_key`, `capture.taken_at`, `capture.date`, or `capture.year_month`.
- If no date metadata exists, sets error message: `This item has no date metadata yet.`
- Calls catalog date browse, not text search.
- Label is formatted as a readable date or month.
- Detail closes.
- Results show date-browse chip in the search bar.

Backend call:

- `GET /catalog/items?date_prefix=YYYY-MM-DD&order=asc`
- Or month prefix when only `YYYY-MM` is available.

Desktop rewrite implications:

- Same-date should become a filter chip or timeline navigation.
- Add adjacent date range controls, month grouping, and calendar filters.

### 12.7 Similar Search

Interaction:

- Detail action `Similar`.

Behavior:

- Clears detail item.
- Sets similar source.
- Dispatches `SIMILAR_SEARCH`.
- Scrolls to top.
- Submitted query becomes `similar items`.
- Query text is cleared.
- Search bar renders similar chip.
- Calls similar-by-ID endpoint.

Failure:

- Shows `Similar search is available after this item has an indexed embedding.`

Spec/code note:

- The spec implies active search should show spinner in the icon slot. Current code sets `similarSourceItem` before fetching, so the similar chip can appear during loading instead.

Desktop rewrite implications:

- Preserve as a major product feature.
- Add "search visually similar" as a contextual action, and add upload/drop-image similar search using the backend upload endpoint.
- Consider exposing the source item and allowing source replacement.

### 12.8 About Sheet

Primary file: `AboutSheet.tsx`

Opened from:

- Detail More actions -> `About`.

Content:

- AI-generated search description if available.
- `When & Where`:
  - formatted date/time.
  - city/state/country.
  - fallback: `No date or location data`.
- `File Info`:
  - media kind.
  - dimensions.
  - duration.
  - filename.
- `Status`:
  - NSFW badge.
  - Safe badge.
  - Not reviewed badge.

Interactions:

- `Done` closes sheet.
- Header click also closes.

Desktop rewrite implications:

- Turn this into a persistent inspector panel or metadata drawer.
- Include raw EXIF optionally, file path, source folder/album, embedding/index status, annotation status, and actions to edit or refresh metadata.

### 12.9 Image Detail

Primary file: `ImageDetailView.tsx`

Behavior:

- Uses resolved media URL, falling back to media or thumbnail link.
- Disables context menu.
- Uses item title as alt text.
- Wraps media in shared detail chrome.

Desktop rewrite implications:

- Add zoom, pan, fit/fill, actual-size, rotate if needed, and open-in-file-manager.

### 12.10 Video Detail

Primary file: `VideoDetailView.tsx`

Video state:

- `currentTime`
- `duration`
- `isPlaying`
- `isScrubbing`
- `chromeVisible`
- `isMuted`

Controls:

- Play/pause.
- Mute/unmute.
- Timeline slider.
- Elapsed and duration labels.
- Same action row as image detail.

Behavior:

- Starts muted.
- First play auto-unmutes.
- Chrome hides after 2400 ms while playing unless scrubbing.
- Click video toggles chrome visibility.
- On pause/end, chrome becomes visible.
- On item change, playback state resets.
- Sensitive hidden video shows poster/static image instead of video.

Desktop rewrite implications:

- Desktop video needs richer controls: keyboard shortcuts, fullscreen, volume slider, frame preview, playback speed, maybe trim/metadata.

## 13. Sensitive Content UX

Primary files:

- `useNsfwReveal.ts`
- `NsfwDialog.tsx`
- `SensitiveDetailPrompt.tsx`
- `MediaGrid.tsx`
- `SettingsSheet.tsx`

### 13.1 Safety State

Sensitive status is based on:

- `item.metadata.safety?.state === "nsfw"`

Reveal state is frontend session-local:

- Set of revealed item IDs.
- Boolean reveal-all flag.
- Pending NSFW item.

No reveal state persists across reloads.

### 13.2 Grid Guard

Sensitive tiles:

- Thumbnail is blurred.
- Image is scaled slightly to hide details at edges.
- Dark overlay appears.
- Eye-off icon appears.
- Aria-label says `Sensitive content - tap to review`.

Tap:

- Opens NSFW bottom sheet.

### 13.3 NSFW Bottom Sheet

Content:

- Icon.
- Title: `Sensitive Content`.
- Body: `This photo/video was flagged by automated review.`
- Button: `View`.
- Button: `Keep Hidden`.
- Divider.
- Button: `Show all sensitive for this session`.

Interactions:

- `View` reveals one item and opens detail.
- `Keep Hidden` closes sheet.
- `Show all sensitive for this session` reveals all NSFW items for the current session.
- Closing the sheet keeps item hidden.

### 13.4 Detail Interstitial

When detail navigation lands on a sensitive item:

- Media remains blurred/hidden.
- Prompt appears with title `Sensitive Content`.
- Body: `This item is hidden until you choose to view it.`
- Single `View` button reveals that item.
- Back and previous/next navigation remain available.

### 13.5 Settings Sensitive Toggle

Settings has `Show sensitive results`.

Code behavior:

- Toggling on calls `onRevealAll`.

Spec/code note:

- Comments describe settings controls as cosmetic mock controls, but this one has real reveal-all behavior.

Backend safety note:

- Safety is currently metadata-driven and UI-enforced.
- `/media/{id}` serves originals if requested directly.
- Backend accepts safety states `safe`, `nsfw`, and `unknown`.

Desktop rewrite implications:

- Define content-safety policy before UI design.
- Decide whether safe search is a filter, a reveal gate, a global preference, or an account-level setting.
- Consider persistent explicit consent, per-session reveal, audit logging, and server-side media gating.
- Gate on `safety.state`, not safety score, because catalog data may contain legacy or inconsistent scores.

## 14. Settings and Indexed Albums

Primary files:

- `SettingsSheet.tsx`
- `IndexedAlbumsSheet.tsx`
- `useIndexedAlbums.ts`
- `phoneUtils.ts`

### 14.1 Settings Sheet

Opened by:

- Home header avatar.

Visible sections:

- Account:
  - Avatar.
  - `Test Participant`.
  - `tester@recall.app`.
- `Search & Indexing`:
  - `Indexed Albums` row with selected count.
  - `Show sensitive results` switch.
- `Appearance`:
  - `Default grid density` value.
- `About`:
  - `Recall`.
  - `Version 1.0`.

Interactions:

- `Done` closes.
- `Indexed Albums` opens child sheet.
- Escape can be disabled while child sheet is open.
- Sensitive switch reveals all sensitive items when toggled on.

Prototype-only notes:

- Account is fake.
- Version is static.
- Indexed albums do not affect backend indexing.
- Default grid density row displays current density but does not edit it from settings.

### 14.2 Indexed Albums Sheet

State:

- Local draft `Set`.
- Initial selected IDs read from localStorage or defaults.

Mock albums:

- Camera
- Screenshots
- Videos
- WhatsApp
- Downloads
- Instagram
- Telegram
- Saved

Default selection:

- Camera
- Screenshots
- WhatsApp
- Downloads
- Instagram
- Saved

Visible elements:

- Title: `Indexed Albums`.
- Subtitle: `Select the albums you want to be indexed`.
- 3-column album grid.
- Cancel button.
- Save button with selected count when count is non-zero.

Interactions:

- Tap album toggles `aria-pressed`.
- Save commits selected IDs to localStorage key `recall.indexedAlbums.v1`.
- Cancel/backdrop/Escape discards draft.
- Save is disabled until draft differs from initial selection.
- Unknown stored IDs are dropped on read.

Desktop rewrite implications:

- Make library sources real: folders, albums, providers, ignored folders, scan state, errors, permissions.
- Persist source choices in backend/native app config, not browser localStorage.
- Show indexing progress and per-source counts.

## 15. Loading, Empty, Error, and Offline States

### 15.1 Frontend Loading States

- Lazy route loading: currently blank.
- Start trial button: `Loading...`, though start is effectively synchronous.
- Favorites grid: skeleton tiles.
- Search grid: skeleton tiles.
- Load more: trailing skeleton tiles and `Loading...` button text.
- Search/autosearch: spinner in search bar icon slot.
- Pull-to-load: circular progress indicator and text.

### 15.2 Empty States

- Empty compose with no history and no query: renders nothing.
- Non-empty compose with no suggestions: `Press Enter to search`.
- Search results empty: `No results`, `Try another description.`
- Date browse empty: `No items found`, `No items found for this date.`
- Trial times empty: `No trials yet - press Start to begin.`
- Results screen with no session results: generic metric cards.
- About sheet missing date/location: `No date or location data`.

### 15.3 Error States

Search:

- If semantic search fails in dev, show backend-unavailable alert and mock tiles.
- If similar search fails, show embedding-unavailable message.
- If date browse fails, show date load failure message.

Mutation:

- Favorite patch failure sets error message.
- Safety patch failure sets error message.

Backend:

- Missing catalog/media items return 404.
- Invalid date prefix returns 400.
- Similar upload unsupported type returns 415.
- Similar upload too large returns 413.

Client limitation:

- Current `recallFetch` turns non-2xx responses into generic status errors, losing FastAPI `detail` bodies.

Desktop rewrite implications:

- Add a unified error model and preserve backend detail messages.
- Avoid blank lazy-loading states.
- Add offline/backend health state.
- Distinguish "index unavailable", "no indexed media", "query returned no matches", and "provider/API failure".

## 16. Keyboard, Pointer, Touch, and Accessibility

### 16.1 Keyboard Behavior

Search input:

- Enter submits search.
- Escape while composing closes compose.

Phone viewport:

- Escape in detail closes detail.
- Escape in compose closes compose.
- Escape in non-home resets search.
- ArrowLeft/ArrowRight in detail navigates previous/next.

Grid tile:

- Enter/Space toggles selection.

Video:

- Timeline is a range slider with aria-label and aria-valuetext.

### 16.2 Pointer and Touch Behavior

- Short press safe tile -> select.
- Long press safe tile -> detail.
- Movement cancels long press.
- Pinch changes grid density.
- Ctrl+wheel changes grid density.
- Down-scroll behavior differs by compose background.
- Touch overscroll at results bottom loads more.
- Detail horizontal swipe navigates.
- Detail ignores drag starts from buttons, menus, inputs, textareas, selects, and menu items.
- Context menu is suppressed on media thumbnails/detail media.

### 16.3 Accessibility Strengths

- Search input has aria-label.
- Many icon buttons have labels.
- Tile buttons have descriptive labels.
- Selected tiles use `aria-pressed`.
- Selection tray uses `role="region"` and `aria-live`.
- Sensitive detail prompt uses `aria-live`.
- Album buttons use `aria-pressed`.
- Radix sheets/dropdowns provide dialog/menu primitives.
- Detail view has aria-label based on item title.

### 16.4 Accessibility Gaps for Desktop Rewrite

- Search suggestions are buttons, not a full combobox/listbox.
- History remove buttons may be focusable while visually hidden in some CSS states.
- Long press is not accessible as a primary open action.
- Tile click selecting instead of opening may surprise desktop users.
- Need robust focus restoration for sheets, detail panes, and command palette.
- Need keyboard shortcuts for open, close, next, previous, favorite, reveal, select, search focus, and grid density.
- Need reduced-motion behavior carried forward.

## 17. Backend Capability Map

Primary files:

- `backend/main.py`
- `backend/routes/search.py`
- `backend/routes/catalog.py`
- `backend/routes/media.py`
- `backend/routes/trials.py`
- `backend/services/catalog/db.py`
- `backend/services/catalog/schema.py`
- `backend/services/search/text_index.py`
- `backend/services/search/chroma.py`

### 17.1 Startup

On app startup:

- Configure Chroma.
- Configure SQLite catalog.
- Build in-memory text index from catalog search terms.

CORS:

- Allows localhost and LAN IP ranges.

Desktop rewrite implications:

- Desktop app may embed the backend, run a local service, or replace it with a native data layer. Either way, startup/index readiness should be visible to users.

### 17.2 Search Endpoints

`GET /search/semantic?q=&n=`

- Embeds query text with Gemini.
- Searches Chroma.
- Hydrates matching IDs from SQLite summaries.
- Returns distances.

`GET /search/text?q=&n=`

- Searches in-memory phrase index.
- Exact match first.
- Prefix fallback.
- Fuzzy fallback.
- Returns `distance: null`.
- Currently used for standalone backend text search and suggestion infrastructure, not merged into the phone result grid.

`GET /search/suggest?q=&n=`

- Uses the same text index.
- Prefix suggestions first, fuzzy suggestions next.

`GET /search/similar/{id}?n=`

- Reads existing item embedding from Chroma.
- Searches Chroma with `n + 1`.
- Excludes source ID.
- Returns 404 if embedding is missing.
- Makes no Gemini call.

`POST /search/similar?n=`

- Accepts image upload only:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `image/gif`
- Max upload size: 20 MB.
- Processes upload to embeddable image/video bytes.
- Embeds with Gemini.
- Searches Chroma.
- Deletes temporary file.

Desktop rewrite implications:

- The UI currently does not expose upload-based visual search. A desktop app should support drag/drop or paste image to search visually similar media.
- Add combined vector+metadata filters if desktop needs filtered semantic search.
- Add stable result sessions or pagination.

### 17.3 Catalog Endpoints

`GET /catalog/items`

Filters:

- `media_type=image|video`
- `favorite=true|false`
- `date_prefix=YYYY-MM|YYYY-MM-DD`
- `order=asc|desc`
- `limit` from 1 to 500

Sort:

- `taken_sort`, then ID.
- Null dates sort last.

`GET /catalog/items/{id}`

- Returns full metadata.
- Includes raw EXIF and system metadata.

`PATCH /catalog/items/{id}`

Patchable groups:

- `organization.favorite`
- `safety.state`
- `search.phrases`

Allowed safety states:

- `safe`
- `nsfw`
- `unknown`

Side effect:

- Rebuilds text index after patch.

`POST /catalog/items/batch`

- Hydrates multiple IDs.
- Returns `results` and `missing`.

`GET /catalog/facets`

- Media type counts.
- Taken year-month counts.

`GET /catalog/stats`

- Total count.
- Counts by media type.

Desktop rewrite implications:

- Current facets are minimal. Desktop filters will likely need location, safety, favorite, folder/source, date range, duration, MIME, orientation, annotation status, and media type.
- Catalog browse needs offset/cursor pagination.
- Full metadata endpoint should back a desktop inspector.

### 17.4 Media Endpoints

`GET /media/{id}`

- Serves original media bytes.
- Uses metadata asset path.
- Returns MIME type if known.

`GET /media/{id}/thumbnail`

- Serves 320 px WebP thumbnail.

`GET /media/{id}/animated-thumbnail`

- Serves animated WebP thumbnail when available.

404 variants:

- Item not found.
- Path missing from item metadata.
- Thumbnail not available.
- Animated thumbnail not available.
- File not found on disk.

Desktop rewrite implications:

- 320 px thumbnails may be too small for desktop high-DPI grids.
- Add larger preview sizes, progressive loading, and media caching.
- Decide whether original media serving should be gated for sensitive content.

### 17.5 Trials Endpoint

`GET /trials?n=`

- Returns random catalog item summaries.
- Current frontend has a `fetchTrials` helper but does not call it.

Desktop rewrite implications:

- Keep only for research mode.

## 18. Metadata and Data Model

Primary files:

- `backend/services/catalog/schema.py`
- `backend/services/catalog/_db_serialization.py`
- `frontend/src/shared/types/recall.ts`

### 18.1 Summary Metadata

Summary/list/search results include:

- `asset`
  - filename
  - mime type
  - media type
  - width
  - height
  - duration
  - paths in backend storage
- `capture`
  - taken at
  - date
  - year-month
  - sort key
  - source
  - location
- `search`
  - description
  - phrases
- `safety`
  - state
  - score
- `organization`
  - favorite
  - folders

Full item metadata additionally includes:

- `raw.exif`
- `system`
  - schema version
  - indexed time
  - embedding provider/model/dimensions
  - content hash

### 18.2 Promoted SQLite Columns

Queryable/promoted fields include:

- content hash
- asset path
- thumbnail path
- animated thumbnail path
- filename
- MIME type
- embedding MIME type
- width
- height
- duration
- taken at/date/year-month/sort/source
- location city/state/country/country code/lat/lon
- search description
- search phrases
- annotation provider/model/updated time
- favorite
- folders
- annotation flag
- safety state
- safety score

### 18.3 Search Phrases

Text index is built from `metadata.search.phrases`.

Behavior:

- Terms are normalized to lowercase.
- Exact term match wins.
- Prefix suggestions/search fallback.
- Fuzzy suggestions/search fallback using RapidFuzz threshold 60.

Desktop rewrite implications:

- Make search result provenance visible: semantic match, exact phrase match, fuzzy phrase match.
- If users can edit phrases/tags, show that updates affect text search immediately.

### 18.4 Schema Synchronization Risk

Frontend TypeScript types are hand-maintained separately from backend Pydantic/metadata schema.

Desktop rewrite implications:

- Use generated types or shared schema.
- Formalize response models for catalog list, full item, search result, facets, stats, and patch results.

## 19. Indexing and Media Processing

Primary files:

- `backend/services/pipeline/indexer.py`
- `backend/services/pipeline/media.py`
- `backend/services/pipeline/nsfw.py`
- `backend/services/pipeline/annotator.py`
- `backend/config.py`

### 19.1 Current Product Boundary

Indexing is maintainer-only in this prototype.

Participants receive:

- Pre-indexed SQLite catalog.
- Pre-indexed ChromaDB vector store.
- Thumbnails.
- Media bundle.

They run only the API server.

Desktop rewrite implication:

- A real desktop app must turn indexing into an end-user workflow: choose sources, scan, deduplicate, thumbnail, embed, annotate, detect safety, monitor progress, pause/resume, retry failures, and refresh metadata.

### 19.2 Supported Media

Images:

- JPG/JPEG/JFIF/PJPEG/PJP
- PNG/APNG
- WebP
- GIF
- HEIC/HEIF

Videos:

- MP4
- M4V
- MOV
- AVI
- MKV
- WMV
- FLV
- WebM
- 3GP

Unsupported extensions:

- Skipped during indexing.

Path constraint:

- Files must be under `DATA_DIR`.
- Paths are stored relative to `DATA_DIR`.

### 19.3 Processing Rules

Images:

- HEIC/HEIF converted to JPEG bytes for embedding.
- Animated PNG/GIF converted to MP4 for embedding.
- Other unsupported image formats are converted to JPEG.

Videos:

- Native MP4/M4V/MOV under 128 seconds and 48 MB can be embedded directly.
- Other or oversized videos are transcoded to MP4.
- Videos longer than 128 seconds are truncated before embedding.

Thumbnails:

- Static thumbnails are 320 px WebP.
- GIF/APNG static thumbnails use a frame.
- Video thumbnail uses first frame.
- Animated WebP thumbnails are generated for qualifying GIF/animated images, subject to size/frame limits.

Deduplication:

- SHA-256 content hash.
- Duplicates in same run are skipped.
- Already indexed content is skipped unless `--force`.
- Force reuses existing UUID for same content hash.

Desktop rewrite implications:

- Users need visible handling for unsupported files, duplicates, failed thumbnails, failed embeddings, and truncated video indexing.
- Show whether a video was embedded from full content or truncated content.
- Add "open original", "reveal in file manager", and "refresh index" operations.

### 19.4 Annotation and NSFW Detection

Annotation:

- Gemini annotation can write search descriptions and phrases.
- If annotation happens while API is running, text index may need rebuild/restart unless phrases are patched via API.

NSFW:

- Local TIMM model.
- Model: `Marqo/nsfw-image-detection-384`.
- Threshold: 0.9.
- Videos use candidate thumbnail when original image is not available.

Desktop rewrite implications:

- Indexing progress should break down phases: scanning, metadata, thumbnails, embeddings, annotation, safety review.
- Allow users to opt in/out of cloud embedding and annotation.
- Make safety review transparent and editable.

## 20. Persistence Map

Frontend localStorage:

| Key | Meaning | Scope | Product status |
| --- | --- | --- | --- |
| `recall.searchHistory.v1` | Recent search queries | Browser local | Keep concept; move to app preferences/database |
| `recall.phoneGridColumns.v1` | Phone grid density | Browser local | Keep as view preference |
| `recall.indexedAlbums.v1` | Mock album selection | Browser local | Replace with real source settings |
| `recall.longPressHint.v1` | Hint dismissed | Browser local | Likely remove for desktop |
| `recall.trialResults.v1` | Study trial times | Browser local | Research-only |

Frontend in-memory:

- NSFW revealed IDs.
- NSFW reveal-all flag.
- Pending NSFW item.
- Active search abort controllers.
- Prefetched results.
- Current selected items.
- Detail item.

Backend persistent:

- SQLite catalog.
- Chroma embeddings.
- Thumbnail files.
- Media files.

Desktop rewrite implications:

- Move durable product state out of browser localStorage.
- Define app database/config locations and backup/migration behavior.
- Separate user preferences, library index state, and volatile session state.

## 21. Visual and Layout System

### 21.1 Phone Visual System

Primary file: `frontend/src/styles/phone.css`

Current style:

- iOS-inspired light theme.
- Frosted glass surfaces.
- Safe-area awareness.
- Fullscreen phone viewport.
- Persistent top search section.
- Hidden scrollbars.
- Responsive scaling for small phone widths.
- Shared radius and spacing scale derived from base radius.
- Motion via `motion/react` and CSS transitions.
- Reduced-motion support in key places.

Important classes:

- `.phone-rect`
- `.phone-persistent-section`
- `.search-panel`
- `.phone-rect-content`
- `.phone-rect-viewport`
- `.phone-media-grid`
- `.detail-screen`
- `.selection-tray`
- `.about-sheet`
- `.nsfw-sheet`

Desktop rewrite implications:

- Do not copy the phone frame.
- Preserve clarity, hierarchy, fast search access, media-first grid, and direct manipulation.
- Replace safe-area/mobile gestures with desktop-native layout: sidebar, toolbar/search, grid, inspector/detail pane, status bar, command palette, context menus.

### 21.2 User-Testing Visual System

Primary file: `frontend/src/styles/user-testing.css`

Current style:

- Full-viewport centered study screens.
- Action cards.
- Trial times card.
- Dormant two-column target/phone task layout CSS.
- Global minimum width and overflow constraints in shared tokens.

Desktop rewrite implications:

- Remove global app assumptions that force full-screen, hidden overflow, or min-width constraints.
- Design desktop resize behavior, multi-window support, and scroll regions intentionally.

## 22. Known Mismatches and Gaps

### 22.1 Spec vs Code

- Header placement: spec describes header in scroll flow above search bar; code renders header above the persistent search shell and toggles it using scroll-top state.
- Similar-search loading: spec implies spinner should occupy icon slot during search; code sets the similar source before fetching so the similar chip can show during loading.
- Settings mock controls: comments/spec framing say mock controls are cosmetic, but `Show sensitive results` calls `onRevealAll`.
- Selection tray Escape: spec says tray dismisses on Escape; current visible top-level Escape logic primarily closes detail/compose or resets search.

### 22.2 Docs vs Code

- Project guidance says `/` requires at least 1280 x 720 and shows a warning below that. Current frontend trace did not find an implemented warning.
- User-testing README mentions an Instructions screen before first trial. Current route does not use it.
- Backend/docs may mention safety state `sensitive`, but current API allows `safe`, `nsfw`, and `unknown`.

### 22.3 Prototype-Only Coupling

- `Send` and `Confirm` are study-answer actions, not product actions.
- Active trial has no target image despite dormant target panel code.
- Trial correctness is not validated.
- Results submission pipeline is not wired.
- Mock album selection does not affect search/indexing.
- Account/settings are fake.

### 22.4 Scalability Gaps

- Catalog list has limit but no offset/cursor.
- Search load-more reruns with larger `n`.
- No combined semantic + metadata filtering.
- Thumbnails are only 320 px.
- Media endpoints do not gate sensitive content.
- Frontend loses backend error detail.
- TypeScript and backend schemas are hand-synchronized.

## 23. Desktop Rewrite Product Requirements

These requirements are inferred from the current app, not all implemented today.

### 23.1 Preserve

- Persistent search access from every browsing state.
- Live search preview that does not steal focus.
- Explicit search commit that creates a result set.
- Search history and suggestions.
- Semantic + text result merging.
- Favorites.
- Recent/home library browsing.
- Same-date browsing.
- Similar-by-ID search.
- Similar-by-upload search, newly exposed.
- Grid density controls.
- Detail navigation through the source result set.
- Image and video detail views.
- Video playback controls.
- About/metadata view.
- Favorite and safety mutations.
- NSFW reveal gate.
- Loading, empty, error, and no-index states.

### 23.2 Replace

- Phone overlay state with desktop panes and routing.
- Long press as the primary open action.
- Selection tray `Send` with real batch actions.
- Mock indexed albums with real library source management.
- User-testing wrapper as the default route.
- Browser localStorage as durable app state.
- Pull-to-load with desktop pagination/infinite scroll.
- Blank Suspense fallback with visible loading.

### 23.3 Add

- Desktop information architecture:
  - Sidebar for Library, Favorites, Recent, Videos, Screenshots, folders/albums, and saved searches.
  - Top search/command bar.
  - Filter bar with date, type, location, favorite, safety, source, and duration.
  - Main grid/list/timeline area.
  - Inspector/detail pane.
  - Fullscreen media viewer.
  - Indexing/status center.
- Import/indexing workflow:
  - Choose folders/albums.
  - Permissions.
  - Scan status.
  - Deduplication.
  - Embedding/annotation progress.
  - Safety review progress.
  - Failure retry.
- Desktop interactions:
  - Click opens.
  - Double click opens viewer or file.
  - Space quick-look if desired.
  - Cmd/Ctrl+F focuses search.
  - Arrow keys navigate grid and detail.
  - Modifier multi-select.
  - Context menus.
  - Drag/drop image for similar search.
  - Drag/drop media/folders for import.
- Real product actions:
  - Favorite/unfavorite.
  - Mark safe/NSFW.
  - Reveal/hide sensitive.
  - Add/remove from album/folder collection.
  - Export/share.
  - Open original.
  - Reveal in file manager.
  - Copy metadata/path.
  - Reindex item.
- Robust state:
  - URL/native history or restorable app sessions.
  - Saved searches.
  - Preferences.
  - Library database migrations.
  - Error recovery.

### 23.4 Decide

- Is content safety enforced only in UI, or also in media serving?
- Are embeddings/annotations cloud-based, local, or configurable?
- Is search history private by default?
- Are favorites stored in the app catalog or written back to external photo libraries?
- Does the desktop app own albums/folders, mirror filesystem folders, or integrate with OS photo libraries?
- Does user testing remain as a hidden mode?
- Does detail open in a side pane, modal viewer, separate route, or separate native window?
- What is the right model for search result sessions and pagination?

## 24. Screen-by-Screen Rewrite Mapping

| Current prototype surface | Current purpose | Desktop replacement |
| --- | --- | --- |
| `/` Welcome | Start study or open phone tester | Product workspace or onboarding/import setup |
| `/` Trial lobby | Start timed trial and view times | Remove or research mode dashboard |
| `/` Active trial | Phone UI with confirm callbacks | Real desktop app workspace |
| `/` Results | Study completion summary | Research mode results/export only |
| Phone home | Recall header, search, favorites | Library dashboard with sidebar and recent/favorites sections |
| Phone compose | Search suggestions/history overlay | Command/search palette with keyboard navigation |
| Phone results | Media grid with footer/refinements | Search results workspace with filters, sort, pagination |
| Phone detail | Fullscreen media overlay | Inspector pane plus optional full viewer |
| About sheet | Bottom metadata sheet | Right inspector metadata tab |
| NSFW sheet | Mobile safety gate | Modal/inline reveal gate with policy controls |
| Settings sheet | Mock settings | Real preferences/source/indexing settings |
| Indexed albums sheet | Mock local selection | Real source management and indexing scope |
| Selection tray | Study answer submission | Multi-select action bar |

## 25. Interaction Inventory Checklist

Use this as a coverage checklist for the rewrite.

Search and compose:

- Focus search.
- Type query.
- Debounced suggestions.
- Debounced live/autosearch results.
- Explicit Enter search.
- Tap suggestion.
- Tap history entry.
- Toggle history.
- Remove history item.
- Clear all history.
- Clear query over home.
- Clear query over results.
- Escape compose.
- Tap outside compose over results.
- Scroll down compose over home.
- Scroll down compose over results.
- Scroll top to re-expand compose over results.
- Type to re-expand collapsed compose.

Results:

- Initial loading.
- Backend failure.
- Partial backend success.
- Empty results.
- Refinement chip.
- Show more.
- Prefetch near bottom.
- Touch pull to load more.
- Clear result context.
- Similar chip tap to start new search.
- Date chip clear.

Grid:

- Short press safe item.
- Long press safe item.
- Movement cancel long press.
- Enter/Space tile selection.
- Tap sensitive tile.
- Animated thumbnail load.
- Video/GIF badge display.
- Select multiple items.
- Remove selected item.
- Clear/send selection.
- Zoom in.
- Zoom out.
- Ctrl+wheel density.
- Pinch density.

Detail:

- Open detail.
- Close detail.
- Previous/next button.
- Arrow key previous/next.
- Swipe previous/next.
- Boundary swipe.
- Swipe to sensitive item.
- Reveal sensitive detail.
- Favorite toggle.
- Mark NSFW.
- Mark safe.
- Open about.
- Close about.
- Same-date browse.
- Similar search.
- Send/Confirm.
- Image context-menu suppression.
- Video play/pause.
- Video mute/unmute.
- Video scrub.
- Video chrome hide/show.

Settings and safety:

- Open settings.
- Close settings.
- Toggle show sensitive.
- Open indexed albums.
- Toggle album.
- Save albums.
- Cancel albums.
- Discard dirty album draft.
- Escape handling for parent/child sheet.
- View one sensitive item.
- Keep hidden.
- Reveal all sensitive for session.

Harness:

- Start trial.
- Abandon trial.
- Confirm trial.
- Start next trial.
- Clear trial times.
- Finish session.
- Start over.
- Open phone tester from welcome.

Backend/API:

- Health check.
- Catalog recent list.
- Catalog favorite list.
- Catalog date list.
- Catalog item detail.
- Catalog batch hydration.
- Catalog facets.
- Catalog stats.
- Patch favorite.
- Patch safety.
- Patch search phrases.
- Text search.
- Semantic search.
- Suggestions.
- Similar by ID.
- Similar by upload.
- Media original.
- Thumbnail.
- Animated thumbnail.
- Random trials.

## 26. Suggested Desktop Architecture Direction

This is not an implementation plan, but a UX-informed architecture target.

Core app state:

- Library source state.
- Indexing state.
- Query state.
- Search session/result state.
- Selection state.
- Focused/open item state.
- Detail source context.
- Filter/sort state.
- Sensitive reveal state.
- View preferences.

Main desktop layout:

- Left sidebar: sources, smart collections, saved searches.
- Top command/search bar: persistent global search.
- Filter row: query chips, date, media type, favorite, safety, source.
- Main content: virtualized grid/list/timeline.
- Right inspector: metadata, actions, similar, same date, safety, raw EXIF.
- Bottom/status area: indexing, backend health, selection count.
- Full viewer: optional modal/window for image/video immersion.

Backend needs before production desktop:

- Pagination/cursors.
- Rich filters and combined vector/metadata filtering.
- Larger thumbnail variants.
- Upload similar endpoint exposed in UI.
- Better error response preservation.
- OpenAPI/codegen or shared schema.
- Real indexing/import API if backend remains service-based.
- Safety enforcement decision.

Research harness:

- If kept, isolate as `/research` or hidden dev mode.
- Wire target fetching, target display, correctness, metrics, and submission.
- Remove research-only `Send/Confirm` behavior from normal product mode.
