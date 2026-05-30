# User Testing Feature

Guided participant harness for the Recall user-testing demo.

## Screens

- **Welcome** — task framing and a Start Demo action.
- **Instructions** — step-by-step walkthrough before the first trial.
- **Task** — timed phone-search trial with answer confirmation. Supports multiple back-to-back laps with per-lap timing stored in `localStorage`.
- **Results** — lap times table with best/average summaries.

## State

Trial results are persisted to `localStorage` under `recall.trialResults.v1` so they survive page refreshes within a session.
