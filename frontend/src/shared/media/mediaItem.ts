import { recallApiBaseUrl } from "@/shared/api/client";
import type { RecallMediaItem } from "@/shared/types/recall";

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

/** Web-friendly full-size rendition for formats browsers can't show natively (e.g. HEIC). */
export function resolvedDisplayUrl(item: RecallMediaItem): string | null {
  return resolveRecallLink(item.links?.display);
}

export function isVideo(item: RecallMediaItem): boolean {
  const mime = item.metadata.asset?.mime_type ?? "";
  return mime.startsWith("video/");
}

export function isAnimatedImage(item: RecallMediaItem): boolean {
  return resolveRecallLink(item.links?.animated_thumbnail) !== null;
}

export function resolvedAnimatedThumbnailUrl(item: RecallMediaItem): string | null {
  return resolveRecallLink(item.links?.animated_thumbnail);
}

export function isFavorite(item: RecallMediaItem): boolean {
  return item.metadata.organization?.favorite === true;
}

export function isNsfw(item: RecallMediaItem): boolean {
  return item.metadata.safety?.state === "nsfw";
}

export function getDurationSeconds(item: RecallMediaItem): number | null {
  return item.metadata.asset?.duration_seconds ?? null;
}

export function getAltText(item: RecallMediaItem): string {
  return item.metadata.search?.description ?? "";
}
