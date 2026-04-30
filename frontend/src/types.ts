export type AppState = 'start' | 'free_use' | 'trial' | 'result_flash' | 'end'

export interface ItemMetadata {
  filename: string
  mime_type: string
  media_type: 'image' | 'video'
  path: string
  content_hash: string
  taken_at?: string
  taken_date?: string
  taken_year_month?: string
  taken_sort?: string
  taken_source?: string
  thumbnail_path?: string
  width?: number
  height?: number
  geo_city?: string
  geo_state?: string
  geo_country?: string
  [key: string]: string | number | boolean | undefined
}

export interface MediaItem {
  id: string
  metadata: ItemMetadata
}

export interface SearchResult {
  id: string
  distance: number | null
  metadata: ItemMetadata
}

export interface LibraryResponse {
  count: number
  results: MediaItem[]
}

export interface TrialEvent {
  type: 'trial_start' | 'search' | 'selection'
  atMs: number
  trialIndex: number
  targetId: string
  query?: string
  resultCount?: number
  selectedId?: string
  isCorrect?: boolean
}

export interface TrialMetric {
  trialIndex: number
  targetId: string
  startedAtMs: number
  completedAtMs?: number
  durationMs?: number
  searchCount: number
  selectionCount: number
  wrongSelectionCount: number
  finalQuery?: string
}

export interface SessionMetrics {
  sessionId: string
  startedAtIso: string
  completedAtIso?: string
  targetIds: string[]
  events: TrialEvent[]
  trials: TrialMetric[]
}
