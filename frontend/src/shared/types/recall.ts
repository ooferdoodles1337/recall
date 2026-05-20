export type RecallMediaType = "image" | "video";

export interface RecallMediaLinks {
  media?: string;
  thumbnail?: string;
}

export interface RecallMediaMetadata {
  asset?: {
    filename?: string;
    mime_type?: string;
    media_type?: RecallMediaType;
    paths?: {
      original?: string;
      thumbnail?: string;
    };
    width?: number;
    height?: number;
    duration_seconds?: number;
  };
  capture?: {
    taken_at?: string;
    date?: string;
    year_month?: string;
    sort_key?: string;
    source?: string;
    location?: {
      city?: string;
      state?: string;
      country?: string;
      country_code?: string;
      latitude?: number;
      longitude?: number;
    };
  };
  search?: {
    description?: string | null;
    phrases?: string[];
  };
  safety?: {
    state?: string;
    score?: number;
  };
  organization?: {
    favorite?: boolean;
    folders?: string[];
  };
  [key: string]: unknown;
}

export interface RecallMediaItem {
  id: string;
  metadata: RecallMediaMetadata;
  links?: RecallMediaLinks;
}

export interface RecallSearchResult extends RecallMediaItem {
  distance: number | null;
}
