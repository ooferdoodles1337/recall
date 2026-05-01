export type MediaType = 'image' | 'video'
export type SafetyState = 'safe' | 'sensitive' | 'nsfw' | 'unknown'

export interface MediaLinks {
  media: string
  thumbnail?: string
}

export interface MediaMetadata {
  asset: {
    filename: string
    mime_type: string
    media_type: MediaType
    paths: {
      original: string
      thumbnail?: string
    }
    width?: number
    height?: number
    duration_seconds?: number
  }
  capture: {
    taken_at?: string
    date?: string
    year_month?: string
    sort_key?: string
    source?: string
    location?: {
      city?: string
      state?: string
      country?: string
      country_code?: string
      latitude?: number
      longitude?: number
    }
  }
  search: {
    description?: string | null
    phrases: string[]
    annotation?: {
      provider: string
      model: string
      updated_at: string
    }
  }
  safety: {
    state: SafetyState
    score?: number
    labels?: Record<string, number>
    provider?: string
    model?: string
    checked_at?: string
  }
  organization: {
    favorite: boolean
    folders: string[]
  }
  raw: {
    exif: Record<string, string | number | boolean>
  }
  system: {
    schema_version: number
    content_hash?: string
    indexed_at?: string
    embedding?: {
      provider: string
      model: string
      dimensions: number
    }
  }
}

export interface MediaItem {
  id: string
  metadata: MediaMetadata
  links: MediaLinks
}

export interface SearchResult extends MediaItem {
  distance: number | null
}

export interface CatalogResponse {
  count: number
  results: MediaItem[]
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
}
