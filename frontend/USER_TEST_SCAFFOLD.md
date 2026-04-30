# User Test Scaffold

This frontend is structured as a self-contained browser user test with two entry paths:

- Guided demo: target-photo tasks with timing and selection metrics.
- Free use: unguided Recall search exploration, separate from guided task metrics.

## Current Flow

`src/App.tsx` owns the top-level mode:

- `start`: welcome screen.
- `free_use`: phone-sized Recall UI without a target.
- `trial`: split-screen target task.
- `result_flash`: short transition after a correct selection.
- `end`: metrics summary.

## Backend API Contracts

Use the local Vite proxy through `API_BASE = "/api"`.

- `GET /trials?n=8`: target photos for guided tasks.
- `GET /search/semantic?q=...&n=24`: search results.
- `GET /media/{id}/thumbnail`: grid thumbnails.
- `GET /media/{id}`: full media for target display or preview.
- `GET /media/library?order=desc`: full metadata catalog for chronological gallery work.

The API helpers live in `src/api.ts`.

## Metrics

`src/hooks/useSessionMetrics.ts` tracks:

- session ID and timestamps
- target IDs
- trial start events
- search events with query and result count
- selection events with correctness
- per-trial duration, search count, selection count, wrong selection count

If `VITE_METRICS_ENDPOINT` is set, `finishSession()` posts the metrics payload there. Leave it unset for local-only/manual JSON export.

## Interaction Scaffolding

`src/components/PhoneFrame.tsx` wraps the embedded mobile UI. Its scroll container supports:

- normal mouse-wheel scrolling through CSS overflow
- pointer drag scrolling via `src/hooks/useDragScroll.ts`

## Styling Work Left

Most components intentionally keep `TODO` class names. The frontend team can replace these with final layout and visual styling without changing the data flow:

- `StartScreen`: welcome copy, Start Demo, Try Recall Freely.
- `TrialScreen`: split target panel and phone viewport.
- `FreeUseScreen`: standalone phone viewport.
- `PhoneFrame`: actual phone dimensions/status bar treatment.
- `ResultsGrid`: mobile result grid and wrong-selection feedback.
- `EndScreen`: metric summary and export/submission affordances.
