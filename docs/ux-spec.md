# Phone UI — UX Specification

This document is the authoritative source of UX behavior for the `/phone` route.
**Always read this file before modifying `PhoneViewportFrame.tsx`, `phoneReducer.ts`,
`SearchCommandLayer.tsx`, or any CSS under `.phone-rect`.**

---

## Scroll / swipe behavior

### SR-1 — Compose panel dismisses on downward scroll
When the user is in `compose` mode and scrolls down (any amount), the compose panel
must close immediately (dispatch `COMPOSE_DISMISS`, blur the input). The query text
in the bar is preserved so the user can resume typing if they scroll back up.

**Rationale:** scrolling signals intent to browse results, not to type. Keeping the
compose panel open while the grid scrolls underneath it is disorienting.

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

---

## Mode transitions

### MT-1 — Entering detail does not affect the search bar
Detail mode covers the persistent section visually; no extra state resets are needed.

---

## Grid density

### GD-1 — Ctrl+wheel changes column count
`Ctrl + scroll wheel` cycles grid density (`cols`: 2 → 3 → 4 → 2). Defined in the
existing wheel handler.

---

## Selection tray

*(Existing behavior — do not regress.)*
- Long-press or checkbox tap adds item to selection tray.
- Tray appears at bottom when ≥ 1 item selected.
- "Use selected" button submits selection and fires result callback.
- Tray is dismissed by tapping outside or pressing Escape.
