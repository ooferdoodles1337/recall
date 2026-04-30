import { API_BASE, METRICS_ENDPOINT, SEARCH_RESULTS_COUNT } from './constants'
import type { LibraryResponse, MediaItem, SearchResult, SessionMetrics } from './types'

export async function fetchTrials(n: number): Promise<MediaItem[]> {
  const res = await fetch(`${API_BASE}/trials?n=${n}`)
  if (!res.ok) throw new Error(`Failed to fetch trials: ${res.status}`)
  const data = await res.json()
  return data.targets as MediaItem[]
}

export async function fetchSearch(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, n: String(SEARCH_RESULTS_COUNT) })
  const res = await fetch(`${API_BASE}/search/semantic?${params}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  const data = await res.json()
  return data.results as SearchResult[]
}

export async function fetchLibrary(): Promise<MediaItem[]> {
  const res = await fetch(`${API_BASE}/media/library?order=desc`)
  if (!res.ok) throw new Error(`Failed to fetch library: ${res.status}`)
  const data = await res.json() as LibraryResponse
  return data.results
}

export async function submitSessionMetrics(metrics: SessionMetrics): Promise<void> {
  if (!METRICS_ENDPOINT) return

  const res = await fetch(METRICS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metrics),
  })
  if (!res.ok) throw new Error(`Metrics submission failed: ${res.status}`)
}

export function mediaUrl(id: string): string {
  return `${API_BASE}/media/${id}`
}

export function thumbnailUrl(id: string): string {
  return `${API_BASE}/media/${id}/thumbnail`
}
