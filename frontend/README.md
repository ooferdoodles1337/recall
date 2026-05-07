# Recall Frontend

Scaffold for the browser-based Recall user test harness and the standalone phone tester UI.

This first pass intentionally implements only the application structure. The user test flow, search behavior, metrics collection, and Airtable/export integration are placeholders.

## Apps

- `UserTestingWebUI` (`/` or `/test`) - future guided participant flow:
  - Welcome screen
  - Split-screen task loop with target photo and embedded phone UI
  - Results screen with timing and UX metrics
- `PhoneTesterUI` (`/phone`) - future freely accessible mobile Recall UI without task framing.

## Local Development

```bash
npm install
npm run dev
```

The frontend dev server runs at `http://localhost:5173`.
The FastAPI backend runs separately at `http://localhost:8000`.

By default the frontend will call the local Recall API at `http://localhost:8000`. Override with:

```bash
VITE_RECALL_API_BASE_URL=http://localhost:8000 npm run dev
```

## Directory Layout

```text
frontend/
  src/
    user-testing-webui/  Guided participant-test app shell
    phone-tester-ui/    Standalone mobile Recall app shell
    shared/             Shared API clients, types, and utilities
```

## Intended Backend Usage

The frontend should only call the local FastAPI backend:

- `GET /trials?n=...` for target photos
- `GET /search/text?q=...` and `GET /search/semantic?q=...` for search
- `GET /media/{uuid}` and `GET /media/{uuid}/thumbnail` for media display
- future local endpoint or direct webhook for session metric export
