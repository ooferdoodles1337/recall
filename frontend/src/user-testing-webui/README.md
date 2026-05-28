# User Testing WebUI

Guided participant harness for the Recall user-testing demo.

## Screens

- **Welcome** — task framing and a Start Demo action.
- **Instructions** — step-by-step walkthrough before the first trial.
- **Task** — timed trial: target photo panel on the left, phone search viewport on the right. Supports multiple back-to-back laps with per-lap timing stored in `localStorage`.
- **Results** — lap times table, best/average, and session export.

## State

Trial results are persisted to `localStorage` under `recall.trialResults.v1` so they survive page refreshes within a session.

