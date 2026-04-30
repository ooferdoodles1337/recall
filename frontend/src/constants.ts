export const TRIAL_COUNT = 8
export const SEARCH_RESULTS_COUNT = 24
export const SEARCH_DEBOUNCE_MS = 300
export const RESULT_FLASH_DURATION_MS = 1200

// Base URL for the backend API, proxied through Vite in dev
export const API_BASE = '/api'

// Optional collector endpoint for Airtable/serverless submission.
// Leave unset to keep metrics local-only for manual export.
export const METRICS_ENDPOINT = import.meta.env.VITE_METRICS_ENDPOINT as string | undefined
