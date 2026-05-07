export type RecallMediaType = "image" | "video";

export interface RecallMediaLinks {
  media?: string;
  thumbnail?: string;
}

export interface RecallMediaMetadata {
  path?: string;
  filename?: string;
  media_type?: RecallMediaType;
  taken_at?: string;
  taken_date?: string;
  taken_year_month?: string;
  taken_sort?: string;
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

