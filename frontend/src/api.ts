import { API_BASE, SEARCH_RESULTS_COUNT } from './constants'
import type { MediaItem, SearchResult } from './types'

export async function fetchTrials(n: number): Promise<MediaItem[]> {
  const res = await fetch(`${API_BASE}/trials?n=${n}`)
  if (!res.ok) throw new Error(`Failed to fetch trials: ${res.status}`)
  const data = await res.json()
  return data.targets as MediaItem[]
}

export async function fetchSearch(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, n: String(SEARCH_RESULTS_COUNT) })
  const res = await fetch(`${API_BASE}/search?${params}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  const data = await res.json()
  return data.results as SearchResult[]
}

export function mediaUrl(id: string): string {
  return `${API_BASE}/media/${id}`
}
