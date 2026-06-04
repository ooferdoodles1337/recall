export type HomeFeed = "favorites" | "recents";

export const HOME_RECENTS_MAX = 500;
export const RECENTS_PREFETCH_STALE_MS = 30_000;
export const RECENTS_PREFETCH_VIEWPORT_MULTIPLIER = 2;

/** Feed shown on the home grid before the user has chosen one in Settings. */
export const DEFAULT_HOME_FEED: HomeFeed = "favorites";

export const DEFAULT_HOME_FEED_KEY = "recall.defaultHomeFeed.v1";

function isHomeFeed(value: unknown): value is HomeFeed {
  return value === "favorites" || value === "recents";
}

export function readDefaultHomeFeed(): HomeFeed {
  if (typeof window === "undefined") return DEFAULT_HOME_FEED;
  try {
    const stored = window.localStorage.getItem(DEFAULT_HOME_FEED_KEY);
    return isHomeFeed(stored) ? stored : DEFAULT_HOME_FEED;
  } catch {
    return DEFAULT_HOME_FEED;
  }
}

export function writeDefaultHomeFeed(feed: HomeFeed) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEFAULT_HOME_FEED_KEY, feed);
  } catch {
    // Persistence is a nice-to-have; the in-memory feed still updates.
  }
}
