import { recallApiBaseUrl, recallFetch } from "../../shared/api/client";
import type { RecallMediaItem } from "../../shared/types/recall";

export interface TrialsResponse {
  n: number;
  targets: RecallMediaItem[];
}

export function fetchTrials(n = 10) {
  return recallFetch<TrialsResponse>(`/trials?n=${n}`);
}

export function resolvedThumbnailUrl(item: RecallMediaItem): string | null {
  const rel = item.links?.thumbnail;
  return rel ? `${recallApiBaseUrl}${rel}` : null;
}

export function resolvedMediaUrl(item: RecallMediaItem): string | null {
  const rel = item.links?.media;
  return rel ? `${recallApiBaseUrl}${rel}` : null;
}

export function isVideo(item: RecallMediaItem): boolean {
  const mime = item.metadata.asset?.mime_type ?? "";
  return mime.startsWith("video/");
}
