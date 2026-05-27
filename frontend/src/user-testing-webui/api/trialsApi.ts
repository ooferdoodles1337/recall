import { recallApiBaseUrl, recallFetch } from "../../shared/api/client";
import type { RecallMediaItem } from "../../shared/types/recall";

export interface TrialsResponse {
  n: number;
  targets: RecallMediaItem[];
}

export function fetchTrials(n = 10) {
  return recallFetch<TrialsResponse>(`/trials?n=${n}`);
}

function resolveRecallLink(link?: string): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  return `${recallApiBaseUrl}${link}`;
}

export function resolvedThumbnailUrl(item: RecallMediaItem): string | null {
  return resolveRecallLink(item.links?.thumbnail);
}

export function resolvedMediaUrl(item: RecallMediaItem): string | null {
  return resolveRecallLink(item.links?.media);
}

export function isVideo(item: RecallMediaItem): boolean {
  const mime = item.metadata.asset?.mime_type ?? "";
  return mime.startsWith("video/");
}
