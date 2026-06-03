import type { RecallMediaItem, RecallSearchResult } from "../../src/shared/types/recall";

const imageDataUrl =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%204%203'%3E%3Crect%20width='4'%20height='3'%20fill='%23d9d9e2'/%3E%3C/svg%3E";

interface PhoneItemOptions {
  date?: string;
  durationSeconds?: number;
  favorite?: boolean;
  height?: number;
  mediaType?: "image" | "video";
  mimeType?: string;
  nsfw?: boolean;
  width?: number;
}

export function makePhoneItem(
  id: string,
  description: string,
  options: PhoneItemOptions = {},
): RecallMediaItem {
  const mediaType = options.mediaType ?? "image";
  const mimeType = options.mimeType ?? (mediaType === "video" ? "video/mp4" : "image/jpeg");
  const date = options.date;

  return {
    id,
    metadata: {
      asset: {
        filename: `${id}.${mediaType === "video" ? "mp4" : "jpg"}`,
        media_type: mediaType,
        mime_type: mimeType,
        width: options.width ?? 1200,
        height: options.height ?? 900,
        duration_seconds: options.durationSeconds,
      },
      capture: date
        ? {
            date,
            taken_at: `${date}T09:24:00`,
            sort_key: `${date}T09:24:00`,
            year_month: date.slice(0, 7),
          }
        : undefined,
      organization: {
        favorite: options.favorite ?? false,
      },
      safety: options.nsfw ? { state: "nsfw", score: 0.94 } : undefined,
      search: {
        description,
        phrases: description.toLowerCase().split(/\s+/),
      },
    },
    links: {
      media: mediaType === "video" ? `/media/${id}` : imageDataUrl,
      thumbnail: imageDataUrl,
      animated_thumbnail: mediaType === "video" ? undefined : imageDataUrl,
    },
  };
}

export function asSearchResult(item: RecallMediaItem, distance: number | null): RecallSearchResult {
  return { ...item, distance };
}

export const favoriteOne = makePhoneItem("favorite-01", "Favorite 01", {
  date: "2024-03-18",
  favorite: true,
});

export const favoriteTwo = makePhoneItem("favorite-02", "Favorite 02", {
  date: "2024-03-19",
  favorite: true,
});

export const datedFavorite = makePhoneItem("dated-favorite", "Dated picnic photo", {
  date: "2024-03-18",
  favorite: true,
});

export const videoFavorite = makePhoneItem("video-favorite", "Favorite video clip", {
  date: "2024-03-20",
  durationSeconds: 12,
  favorite: true,
  mediaType: "video",
});

export const hiddenFavorite = makePhoneItem("sensitive-favorite", "Sensitive favorite", {
  favorite: true,
  nsfw: true,
});

export const hiddenSecondFavorite = makePhoneItem("sensitive-second", "Second sensitive favorite", {
  favorite: true,
  nsfw: true,
});

export const favoriteItems: RecallMediaItem[] = [
  favoriteOne,
  favoriteTwo,
  datedFavorite,
  videoFavorite,
  hiddenFavorite,
  hiddenSecondFavorite,
  ...Array.from({ length: 28 }, (_, index) =>
    makePhoneItem(`favorite-extra-${index + 1}`, `Favorite extra ${index + 1}`, {
      date: `2024-04-${String((index % 24) + 1).padStart(2, "0")}`,
      favorite: true,
    }),
  ),
];

export const recentItems: RecallMediaItem[] = Array.from({ length: 51 }, (_, index) =>
  makePhoneItem(`recent-${index + 1}`, `Recent item ${index + 1}`, {
    date: `2024-05-${String((index % 24) + 1).padStart(2, "0")}`,
  }),
);

export const sunsetResult = makePhoneItem("sunset-result", "Sunset pier photo", {
  date: "2024-06-01",
});

export const sharedResult = makePhoneItem("shared-result", "Shared picnic blanket", {
  date: "2024-06-02",
});

export const textOnlyResult = makePhoneItem("text-only-result", "Text-only mountain cabin", {
  date: "2024-06-03",
});

export const videoResult = makePhoneItem("video-result", "Video result clip", {
  date: "2024-06-04",
  durationSeconds: 18,
  mediaType: "video",
});

export const hiddenResult = makePhoneItem("sensitive-result", "Sensitive search result", {
  nsfw: true,
});

export const semanticResults: RecallSearchResult[] = [
  asSearchResult(sunsetResult, 0.02),
  asSearchResult(sharedResult, 0.05),
  asSearchResult(videoResult, 0.08),
  asSearchResult(hiddenResult, 0.11),
  ...Array.from({ length: 45 }, (_, index) =>
    asSearchResult(
      makePhoneItem(`semantic-extra-${index + 1}`, `Semantic extra ${index + 1}`, {
        date: `2024-07-${String((index % 24) + 1).padStart(2, "0")}`,
      }),
      0.2 + index / 100,
    ),
  ),
];

export const textResults: RecallSearchResult[] = [
  asSearchResult(sharedResult, 0.01),
  asSearchResult(textOnlyResult, null),
];

export const dateResults: RecallSearchResult[] = [
  asSearchResult(datedFavorite, 0.04),
  asSearchResult(favoriteOne, 0.06),
];

export const similarResults: RecallSearchResult[] = [
  asSearchResult(makePhoneItem("similar-result", "Similar yellow umbrella", { date: "2024-08-01" }), 0.03),
];

export const defaultSuggestions = ["sunset picnic", "sunset pier", "sunlit cabin"];
