import { API_BASE, DEFAULT_SEARCH_LIMIT } from './constants'
import type { CatalogResponse, MediaItem, SearchResponse, SearchResult } from './types'

async function readJson<T>(res: Response, message: string): Promise<T> {
  if (!res.ok) throw new Error(`${message}: ${res.status}`)
  return await res.json() as T
}

export async function fetchCatalog(): Promise<MediaItem[]> {
  const res = await fetch(`${API_BASE}/catalog/items?order=desc`)
  const data = await readJson<CatalogResponse>(res, 'Failed to fetch catalog')
  return data.results
}

export async function fetchSearch(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, n: String(limit) })
  const res = await fetch(`${API_BASE}/search/semantic?${params}`)
  const data = await readJson<SearchResponse>(res, 'Search failed')
  return data.results
}

export function absoluteApiUrl(path: string): string {
  return path.startsWith('/api/') ? path : `${API_BASE}${path}`
}
