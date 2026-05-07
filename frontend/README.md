# Recall Frontend

React/Vite frontend for the Recall user-testing demo.

The main app is a fullscreen desktop user-testing harness. Participants are
shown a target photo, then use an embedded phone-sized Recall viewport to find
the matching item. The standalone `/phone` route is still a placeholder for
freely exploring the phone UI outside a guided trial.

## Requirements

- Node.js compatible with Vite 7
- npm
- Local Recall backend at `http://localhost:8000`

## Local Development

Run commands from `frontend/`.

```bash
npm install
npm run dev
```

The Vite dev server runs at `http://localhost:5173`.

The frontend calls the local API at `http://localhost:8000` by default. Override
it when needed:

```bash
VITE_RECALL_API_BASE_URL=http://localhost:8000 npm run dev
```

Build and typecheck:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Routes

- `/` and other non-`/phone` paths render `UserTestingWebUI`.
- `/phone` renders `PhoneTesterUI`.

## User Testing UI

`src/user-testing-webui/` owns the guided participant flow:

- Welcome screen
- Instructions screen
- Task screen with target media, progress rail, and participant viewport frame
- Results screen

The guided UI is intentionally desktop-only. It is meant to run fullscreen or in
a large desktop window. If the viewport is smaller than `1280 x 720`, the app
shows a window-size warning instead of trying to reflow the task interface.

The visual direction is a quiet photo-archive / usability-lab console:

- `Source Serif 4 Variable` for display headings
- `IBM Plex Sans` for UI/body text
- `IBM Plex Mono` for counters and labels
- Warm paper, ink, archive green, rust, gold, and blue accents

Fonts are self-hosted through Fontsource imports in `src/main.tsx`; do not add
external Google Fonts CSS imports.

## Phone Tester UI

`src/phone-tester-ui/` currently contains the standalone phone tester shell. The
actual Recall phone search UI still needs to be implemented. The guided task
screen embeds a framed participant viewport through `PhoneViewportFrame`.

## Directory Layout

```text
frontend/
  src/
    main.tsx               Fontsource imports and React entrypoint
    App.tsx                Route switch and desktop-size warning
    styles/global.css      Shared visual system and screen layouts
    shared/                API client, shared types, and utilities
    user-testing-webui/    Guided participant test harness
    phone-tester-ui/       Standalone phone tester route
```

## Dependencies

- React 19
- Vite 7
- Fontsource packages for self-hosted fonts
- Radix Progress for accessible task progress state

Use custom CSS for the app's visual identity. Radix primitives are useful for
accessible behavior, but avoid introducing a large styled component kit unless
the design direction is intentionally revisited.

## Backend API Usage

The frontend should only call the local FastAPI backend:

- `GET /trials?n=...` for target photos
- `GET /search/text?q=...` and `GET /search/semantic?q=...` for search
- `GET /search/suggest?q=...` for autocomplete
- `GET /search/similar/{id}` and `POST /search/similar` for similarity flows
- `GET /catalog/items` and `POST /catalog/items/batch` for metadata hydration
- `GET /media/{uuid}` and `GET /media/{uuid}/thumbnail` for media display

## Agent Notes

There is no `frontend/AGENTS.md`. Repository-wide agent guidance lives at the
root `AGENTS.md` symlink.
