import type { RecallMediaItem } from "@/shared/types/recall";
import type { ModeTransition, ModeTransitionReason, MotionDirection } from "../phoneReducer";
export type { ModeTransition, ModeTransitionReason, MotionDirection };

export const SEARCH_BATCH_SIZE = 50;
export const FAVORITES_COUNT = 34;
export const SEARCH_HISTORY_KEY = "recall.searchHistory.v1";
export const GRID_COLUMNS_STORAGE_KEY = "recall.phoneGridColumns.v1";
export const OVERSCROLL_THRESHOLD = 80;

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_CANCEL_DIST_SQ = 64;
export const SELECTION_SUPPRESS_MS = 450;
export const AUTOSEARCH_DEBOUNCE_MS = 400;
export const SUGGESTION_DEBOUNCE_MS = 140;
export const HIDE_COMPOSE_SCROLL_THRESHOLD = 60;
export const PREFETCH_TRIGGER_REMAINING = 200;
export const VIDEO_CHROME_HIDE_MS = 2400;

export type GridColumns = 1 | 2 | 3 | 4 | 5 | 6;

export const GRID_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const satisfies readonly GridColumns[];
export const DEFAULT_GRID_COLUMNS: GridColumns = 3;
export const MIN_GRID_COLUMNS = GRID_COLUMN_OPTIONS[0];
export const MAX_GRID_COLUMNS = GRID_COLUMN_OPTIONS[GRID_COLUMN_OPTIONS.length - 1];

export const GRID_GAP_BY_COLUMNS: Record<GridColumns, string> = {
  1: "12px", 2: "8px", 3: "6px", 4: "4px", 5: "3px", 6: "2px",
};

export const GRID_RADIUS_BY_COLUMNS: Record<GridColumns, string> = {
  1: "16px", 2: "14px", 3: "12px", 4: "10px", 5: "8px", 6: "6px",
};

export const PHONE_MOTION = {
  screenMs: 220,
  detailMs: 300,
  exitMs: 180,
  standard: "cubic-bezier(0.22, 1, 0.36, 1)",
  gentle: "cubic-bezier(0.16, 1, 0.3, 1)",
};

export const MOTION_EASE = {
  standard: [0.22, 1, 0.36, 1] as [number, number, number, number],
  gentle: [0.16, 1, 0.3, 1] as [number, number, number, number],
  exit: [0.4, 0, 1, 1] as [number, number, number, number],
};

export function isItemNsfw(item: RecallMediaItem) {
  return item.metadata.safety?.state === "nsfw";
}

export function makeMockItem(seed: string, q?: string): RecallMediaItem {
  const thumb = `https://picsum.photos/seed/${encodeURIComponent(seed)}/440/330`;
  const media = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/900`;
  return {
    id: seed,
    metadata: {
      asset: {
        filename: `${seed}.jpg`,
        media_type: "image",
        mime_type: "image/jpeg",
      },
      search: { description: q ?? "Sample library item" },
    },
    links: { media, thumbnail: thumb },
  };
}

export function readSearchHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeSearchHistory(nextHistory: string[]) {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory.slice(0, 8)));
}

export function isGridColumns(value: number): value is GridColumns {
  return GRID_COLUMN_OPTIONS.includes(value as GridColumns);
}

export function clampGridColumns(value: number): GridColumns {
  const rounded = Math.round(value);
  if (rounded <= MIN_GRID_COLUMNS) return MIN_GRID_COLUMNS;
  if (rounded >= MAX_GRID_COLUMNS) return MAX_GRID_COLUMNS;
  return isGridColumns(rounded) ? rounded : DEFAULT_GRID_COLUMNS;
}

export function readGridColumns(): GridColumns {
  if (typeof window === "undefined") return DEFAULT_GRID_COLUMNS;
  try {
    const stored = window.localStorage.getItem(GRID_COLUMNS_STORAGE_KEY);
    if (stored === null) return DEFAULT_GRID_COLUMNS;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampGridColumns(parsed) : DEFAULT_GRID_COLUMNS;
  } catch {
    return DEFAULT_GRID_COLUMNS;
  }
}

export function writeGridColumns(nextColumns: GridColumns) {
  try {
    window.localStorage.setItem(GRID_COLUMNS_STORAGE_KEY, String(nextColumns));
  } catch {
    // Persistence is a nice-to-have; the in-memory density still updates.
  }
}

export function nearestGridColumns(value: number): GridColumns {
  return clampGridColumns(value);
}

export function pointerDistance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function pointerMidpoint(first: { x: number; y: number }, second: { x: number; y: number }) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function reduceMotionEnabled() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function mediaLayoutId(itemId: string) {
  return `phone-media-${itemId}`;
}

export function aspectRatioFromDimensions(width?: number, height?: number) {
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return `${width} / ${height}`;
  }
  return null;
}

export function mediaAspectRatio(item: RecallMediaItem) {
  return aspectRatioFromDimensions(item.metadata.asset?.width, item.metadata.asset?.height);
}

export function rememberSearch(query: string) {
  const normalized = query.trim();
  if (!normalized) return;
  const nextHistory = [
    normalized,
    ...readSearchHistory().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ];
  writeSearchHistory(nextHistory);
}

export function mergeResults(...groups: RecallMediaItem[][]): RecallMediaItem[] {
  const seen = new Set<string>();
  const merged: RecallMediaItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

export function localSuggestions(query: string, history: string[]): string[] {
  const q = query.trim();
  if (!q) return history.slice(0, 5);
  const lower = q.toLowerCase();
  const historyMatches = history.filter((item) => item.toLowerCase().includes(lower));
  const semanticCompletions = [
    `${q} video`, `${q} photo`, `${q} meme`, `${q} reaction image`, `${q} from trip`,
  ];
  return [...historyMatches, ...semanticCompletions]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 6);
}

export function itemTitle(item: RecallMediaItem) {
  return item.metadata.search?.description || item.metadata.asset?.filename || item.id;
}

export function itemDateLabel(item: RecallMediaItem) {
  return item.metadata.capture?.date ?? item.metadata.capture?.year_month ?? null;
}

export function durationLabel(seconds?: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function playbackTimeLabel(seconds: number) {
  return durationLabel(seconds) ?? "0:00";
}

export const screenMotionVariants = {
  enter: ({ direction, reason }: ModeTransition) => ({
    opacity: 0,
    y: reason === "search-clear" || reason === "autosearch-commit" ? 0 : direction === "back" ? -10 : 14,
    scale: reason === "search-clear" || reason === "autosearch-commit" ? 1 : direction === "back" ? 1.012 : 0.988,
  }),
  center: { opacity: 1, y: 0, scale: 1, transition: { duration: PHONE_MOTION.screenMs / 1000, ease: MOTION_EASE.standard } },
  exit: ({ direction, reason }: ModeTransition) => {
    const ease = reason === "search-clear" ? [0.4, 0, 0.2, 1] as [number, number, number, number] : MOTION_EASE.exit;
    return {
      opacity: 0,
      y: reason === "search-clear" || reason === "autosearch-commit" ? 0 : direction === "back" ? 16 : -8,
      scale: reason === "search-clear" ? 0.96 : reason === "autosearch-commit" ? 1 : direction === "back" ? 0.986 : 1.01,
      transition: { duration: reason === "search-clear" ? 0.2 : PHONE_MOTION.exitMs / 1000, ease },
    };
  },
};