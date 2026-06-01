# Phone UI — UX Specification

This document is the authoritative source of UX behavior for the `/phone` route.
**Always read this file before modifying `PhoneViewportFrame.tsx`, `phoneReducer.ts`,
`SearchCommandLayer.tsx`, or any CSS under `.phone-rect`.**

---

## Scroll / swipe behavior

### SR-1 — Compose panel collapses on downward scroll (results) or dismisses (home)

When the user is in `compose` mode over the home feed (`bgContent=home`) and scrolls down,
the compose panel must close immediately (dispatch `COMPOSE_DISMISS`, blur the input).
The query text in the bar is preserved so the user can resume typing if they scroll back up.

When the user is in `compose` mode over results (`bgContent=results`) and scrolls down
past 60 px, the suggestions panel collapses with a height exit animation. The search bar
stays visible and the input remains focused. Scrolling all the way back to the top
(`scrollTop <= 0`) re-expands the panel. Typing any character while the panel is
collapsed also re-expands it immediately.

**Rationale over home:** scrolling signals intent to browse results, not to type.
Keeping the compose panel open while the grid scrolls underneath it is disorienting.

**Rationale over results:** the user is refining a query and may want to scroll through
previewed results then scroll back up to continue typing. Dismissing compose entirely
would lose keyboard focus, requiring an extra tap to resume.

### SR-2 — Persistent search bar is always visible
The `.phone-persistent-section` (the search bar strip) is always pinned at the top
of the phone frame and never hides or slides away, regardless of scroll position.
The user must always be able to re-tap the bar and reformulate their query even after
scrolling deep into results.

**Rationale:** hiding the bar trades discoverability for screen real estate — on this
form factor the bar is the primary navigation control and must stay reachable at all
times.

### SR-3 — Search bar is visually identical in all contexts
The same `PhoneSearchBar` component and `.search-bar--semantic` class are used in
both the home sticky section and the persistent section above results. There is no
separate "hero" variant. The bar's size (44px), glass treatment, and button layout
are identical regardless of which screen it appears on.

The `layoutId="search-bar"` Framer Motion attribute animates the bar between its
home sticky position (inside the scroll content) and its persistent position (above
the scroll area) during mode transitions.

### SR-4 — Home header sits above the search bar at scroll top, then scrolls away

On the home screen, the `.phone-startpage-header` (the "Recall" wordmark strip with the
person and × icons) is positioned in the scroll flow **above** the persistent search bar.
When the viewport is at scroll position 0 the header is fully visible, appearing above the
search bar. As the user scrolls down, the header leaves the screen upward; the search bar
stays visible at all times (SR-2).

The header is **not sticky** — it does not pin itself at the top once it has scrolled
off screen. After scrolling down, only the persistent search bar is visible above the
content.

If the user scrolls back up to `scrollTop === 0` after having scrolled away, the header
reappears with its standard slide-in animation (HA-1).

**Rationale:** The header conveys app identity and provides exit/account controls that
are relevant when the user first arrives but do not need to occupy permanent real estate.
Keeping it non-sticky reclaims screen space for the photo grid while ensuring the search
bar (the primary action) is always reachable.

---

## Compose panel

### CP-1 — Maximum 3 suggestions shown
The `SearchAssistPanel` receives at most **3** items in its `suggestions` prop
(via `composeSuggestions` in `PhoneViewportFrame`). This keeps the compose panel
compact enough to stay above the software keyboard on mobile without obscuring the
results grid entirely.

### CP-2 — Unified glass card in all compose contexts
Whenever compose mode is active (whether over the home feed or over results), the search bar
and suggestions panel merge into a single unified glass card:

- The `.search-panel` container wraps both and carries the combined drop shadow.
- The `.search-panel--expanded` class is applied on the container.
- The bar's bottom corners animate to 0 (220ms, standard easing) so the bar connects flush to the panel below.
- The suggestions panel (`.phone-compose-section`) has matching glass background, left/right/bottom
  borders, and rounded bottom corners — forming the lower half of the card.
- Suggestion rows are rendered as a flat list directly inside the panel — no nested card wrapper.
  The glass and border-radius come from the `.phone-compose-section` container, not from a child card.

### CP-3 — Search bar tap always reveals populated content immediately

Tapping the search bar must open the compose panel with content visible in the
same animation frame — no blank intermediate state.

**Content priority:**
1. If query is empty → show history (if available).
2. If query is non-empty and suggestions are cached → show suggestions.
3. If query is non-empty but suggestions are not yet loaded → show history as
   an immediate fallback; replace with suggestions once they arrive.

**Re-expansion:** if the panel was previously collapsed by scroll (SR-1,
`showComposePanel=false`), tapping the bar must re-expand it. `enterComposeMode`
must always set `showComposePanel` to `true`, regardless of current mode.

**Rationale:** an empty panel on tap breaks the mental model that the bar is
always ready. History as a fallback provides instant value while the debounced
suggestion fetch completes.

---

## Mode transitions

### MT-1 — Entering detail does not affect the search bar
Detail mode covers the persistent section visually; no extra state resets are needed.

### MT-2 — Detail swipe navigation follows the source grid

In detail mode, a horizontal swipe navigates to the adjacent item from the grid
that opened detail:
- Details opened from Home/Favorites swipe through the current favorites grid.
- Details opened from Results swipe through the current search results grid.

Swipe left advances to the next item; swipe right returns to the previous item.
At the start or end of the source grid, the swipe is a no-op. Buttons, menus,
inputs, and video timeline controls do not initiate detail swipe navigation.
Detail-to-detail transitions use horizontal spatial continuity: advancing
slides the next item in from the right while the current item exits left; going
back mirrors the direction. Regular open/close transitions keep the existing
detail fade/shared-media motion.

### MT-3 — NSFW detail swipe interstitial

Swiping to an NSFW item must not skip the item and must not reveal it directly.
Instead, detail lands on that item with the media blurred and a centered
"Sensitive Content" prompt. The prompt has a single explicit "View" action that
reveals only that item for the session. Back and horizontal swipe navigation
remain available from the blurred interstitial.

**Rationale:** search and favorites should feel like continuous media sequences,
but swipe navigation must not bypass the safety gate. The blurred in-place prompt
preserves spatial context while requiring deliberate consent before viewing.

---

## Grid density

### GD-1 — Ctrl+wheel changes column count
`Ctrl + scroll wheel` cycles grid density (`cols`: 2 → 3 → 4 → 2). Defined in the
existing wheel handler.

---

## Focus and input ownership

### FC-1 — Autosearch never dismisses compose or steals focus
When autosearch fires (the 400 ms idle timer submits a query automatically),
the compose panel must remain open, suggestions must stay visible, and the
search input must remain focused. Results load silently in the background;
`bgContent` transitions to `"results"` via `AUTOSEARCH_COMMIT` while `screen`
stays `"compose"`. The mode transitions to `results` only when the user
explicitly commits a search (presses Enter or taps a suggestion).

**Rationale:** autosearch is a preview, not a navigation event. Dismissing the
keyboard mid-typing interrupts the user's flow and is a common annoyance in iOS
search UIs.

### FC-2 — Input focus is never stolen while the user is composing
While `mode === "compose"`, nothing in the UI may blur the search input or
dismiss the compose panel except:
- The user pressing Enter or tapping a suggestion (explicit commit).
- The user tapping outside the compose panel.
- The user swiping down (SR-1).
- The user emptying the field over results (SC-1 — returns home).
- An explicit Escape key press.

All internal events — autosearch results arriving, background content
transitions — must leave input focus untouched.

---

## Home screen animations

### HA-1 — Header slides in from the top when home state activates
When the home screen mounts (initial load or return from results), the
`.phone-startpage-header` animates in from above: `y: -20 → 0, opacity: 0 → 1`.
Duration 260 ms, standard easing (cubic-bezier(0.22, 1, 0.36, 1)).

### HA-2 — Header slides up when compose mode activates
When the user activates compose on the home screen, the header animates out
upward — `y: 0 → -16, opacity: 1 → 0` — while simultaneously collapsing its
height to 0 so the search bar slides smoothly into the vacated space. When
compose dismisses and the user returns to home, the reverse plays (HA-1).

---

## History icon

### HI-1 — Icon is only shown when it has a meaningful toggle effect

The history icon button (`.history-btn`) is visible only when toggling it would produce a perceptible change. Specifically, it is shown when **all** of the following hold:

- History is non-empty (`history.length > 0`).
- The current query is non-empty (suggestions are or will be the natural panel content, so the toggle has something to switch *away from*).

When the query is empty, hide the icon — history is already the automatic panel content per CP-3, so the toggle is a no-op and adds visual clutter. When history is empty, hide the icon — there is nothing to toggle to.

**Rationale:** an icon that has no observable effect trains the user to ignore it, and an icon that cannot do anything on press is confusing.

### HI-2 — History icon in results mode (non-compose)

In `results` mode, the persistent search bar contains the committed query (non-empty). Tapping the search input enters compose and shows suggestions (CP-3, non-empty-query path). The history icon is the **only** one-tap shortcut to "open compose and see recent searches instead of suggestions" when a query is already committed. Show it in results mode when history is non-empty; hide it when history is empty.

Do **not** show the history icon in `home` mode — the search bar has no committed query and the natural compose-open state is already history (CP-3, empty-query path).

### HI-3 — Spinner replaces the icon during active search

When `isSearching === true`, the history icon is replaced by a `Loader2Icon` spinner and the button is `disabled`. This reuses the icon slot to signal search progress without adding a separate element. The disabled state prevents accidental toggles while results are loading.

The spinner condition takes precedence over HI-1 visibility logic — if a search is in flight, show the spinner regardless of query/history state.

---

## Search clearing

### SC-1 — Emptying the search field returns to home when results are visible

When the user intentionally empties the search bar — either by backspacing to an
empty string **or** by tapping the × clear button — while a results set is in the
background (`bgContent === "results"`), the UI must return fully to the home state.

**Behavior:**
- `query` and `submittedQuery` are both cleared to `""`.
- Any in-flight search is aborted.
- Mode transitions to `home` via `SEARCH_CLEAR` (uses the `search-clear` animation:
  fade-scale, no directional slide).
- The search input is blurred.

**Scope:** fires whenever `bgContent === "results"` and the field becomes empty —
whether the user is in `compose` mode (typing over results) or `results` mode
(tapping the × button in the persistent bar).
Does **not** fire when `bgContent === "home"` — composing a fresh query over the
home feed can be abandoned by backspacing without triggering any navigation.

**Rationale:** an empty search field over a results screen is a stranded, no-meaning
state. The user's intent is unambiguous: they want to start fresh. The home feed is
the correct destination.

---

## Selection tray

*(Existing behavior — do not regress.)*
- Long-press or checkbox tap adds item to selection tray.
- Tray appears at bottom when ≥ 1 item selected.
- "Use selected" button submits selection and fires result callback.
- Tray is dismissed by tapping outside or pressing Escape.

---

## Settings & Indexed Albums

The "Indexed Albums" picker is a **presentational mock** — it lets a tester choose
which simulated device albums get "indexed", mirroring Google Photos' *Back up
device folders* screen. It has **no functional effect** (ST-6): the backend has no
album concept (the indexer just walks `MEDIA_DIR`). It exists to make the `/phone`
demo feel like a real photo app during user testing.

Components: `SettingsSheet.tsx`, `IndexedAlbumsSheet.tsx`, `useIndexedAlbums.ts`;
mock data + persistence in `phoneUtils.ts` (`MOCK_ALBUMS`,
`DEFAULT_INDEXED_ALBUM_IDS`, `readIndexedAlbums` / `writeIndexedAlbums`,
`INDEXED_ALBUMS_KEY`).

### ST-1 — Entry point
The home-header profile avatar (`PhoneHomeHeader`) is a button (`.phone-avatar-btn`).
Tapping it opens the Settings sheet. The exit (×) button is unchanged. The avatar
is the only entry point; the picker is **not** reachable directly (ST-3 rationale).

### ST-2 — Settings sheet
A full-height slide-up sheet (`.about-sheet.about-sheet--full`) reusing the
`.about-backdrop` / `.about-sheet` glass + motion idiom (15 ms backdrop fade,
220 ms `[0.16, 1, 0.3, 1]` sheet rise). Header shows the title "Settings" and a
"Done" button. Dismiss on Done, backdrop tap, or Escape. Opening it does **not**
touch search state (cf. MT-1 — it is purely an overlay).

### ST-3 — Settings content (mock)
The menu has multiple plausible groups so the picker is never the only thing behind
the profile:
- *Account*: avatar + static name/email.
- *Search & Indexing*: **"Indexed Albums"** (value = `{selected} of {total}`,
  chevron → opens picker) and "Show sensitive results" (cosmetic `Switch`, not
  persisted).
- *Appearance*: "Default grid density" (reflects current `gridColumns`, read-only).
- *About*: app name + version (static).

Only "Indexed Albums" navigates; everything else is cosmetic.

**Rationale:** a settings entry point that opens straight into a single folder
picker is confusing — users expect a settings *surface*. The picker lives as one
row within it.

### ST-4 — Indexed Albums picker
A full-height slide-up sheet (own `AnimatePresence` layer, opens above Settings).
Large title "Indexed Albums" + subtitle, a scrollable 3-column grid of album cards
(square thumbnail, selected-check badge top-right, label below), and a pinned
Cancel/Save footer.
- Tapping a card toggles its **draft** selected state.
- **Save** commits the draft (persists via `useIndexedAlbums.save`) and closes the
  picker, returning to Settings; the Settings count updates. Save is disabled until
  the draft differs from the committed selection.
- **Cancel** / backdrop tap / Escape discards the draft and closes.
- Selection is conveyed by **both** a blue ring and a check icon (never colour
  alone); cards expose `aria-pressed`.

### ST-5 — Persistence
Selections persist in `localStorage` under `INDEXED_ALBUMS_KEY`
(`recall.indexedAlbums.v1`), the same versioned-key pattern as `SEARCH_HISTORY_KEY`
/ `GRID_COLUMNS_STORAGE_KEY`. First run selects `DEFAULT_INDEXED_ALBUM_IDS`.
`readIndexedAlbums` filters out ids not present in `MOCK_ALBUMS`.

### ST-6 — No functional effect
Saving triggers no network call, re-index, or change to results/favorites. Nothing
else in the app reads the stored selection. This is explicitly a mock for demo
realism.
