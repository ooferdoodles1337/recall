export type AppState = 'start' | 'trial' | 'result_flash' | 'end'

export interface ItemMetadata {
  filename: string
  mime_type: string
  media_type: 'image' | 'video'
  path: string
  content_hash: string
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
  distance: number
  metadata: ItemMetadata
}
