import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecallMediaItem, RecallSearchResult } from "../../shared/types/recall";
import {
  listRecentItems,
  searchSemantic,
  searchSimilarById,
  searchText,
  suggestSearches,
} from "../../phone-tester-ui/api/searchApi";
import { isVideo, resolvedMediaUrl, resolvedThumbnailUrl } from "../api/trialsApi";

interface PhoneViewportFrameProps {
  currentTarget?: RecallMediaItem;
  onSelectCandidate?: (id: string) => void;
  onConfirmAnswer?: (id: string) => void;
}

type PhoneMode = "home" | "typing" | "results" | "detail";

interface TapRipple { id: number; clientX: number; clientY: number; }

const SEARCH_BATCH_SIZE = 51;
const SEARCH_HISTORY_KEY = "recall.searchHistory.v1";


function makeMockItem(seed: string, q?: string): RecallMediaItem {
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

function readSearchHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeSearchHistory(nextHistory: string[]) {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory.slice(0, 8)));
}

function rememberSearch(query: string) {
  const normalized = query.trim();
  if (!normalized) return;

  const nextHistory = [
    normalized,
    ...readSearchHistory().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ];
  writeSearchHistory(nextHistory);
}

function mergeResults(...groups: RecallSearchResult[][]): RecallSearchResult[] {
  const seen = new Set<string>();
  const merged: RecallSearchResult[] = [];

  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

function localSuggestions(query: string, history: string[]): string[] {
  const q = query.trim();
  if (!q) return history.slice(0, 5);

  const lower = q.toLowerCase();
  const historyMatches = history.filter((item) => item.toLowerCase().includes(lower));
  const semanticCompletions = [
    `${q} video`,
    `${q} photo`,
    `${q} meme`,
    `${q} reaction image`,
    `${q} from trip`,
  ];

  return [...historyMatches, ...semanticCompletions]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 6);
}

function refinementSuggestions(query: string, results: RecallMediaItem[]): string[] {
  const q = query.trim();
  if (!q) return [];

  const mediaTypes = new Set(
    results
      .map((item) => item.metadata.asset?.media_type)
      .filter((mediaType) => typeof mediaType === "string"),
  );
  const hasVideos = mediaTypes.has("video");
  const base = [
    q.replace(/\bgif\b/i, "meme"),
    q.replace(/\bphoto\b/i, "video"),
    `${q} close up`,
    `${q} outdoors`,
    `${q} funny reaction`,
  ];

  if (!hasVideos) {
    base.unshift(`${q} video`);
  }

  return base
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== q.toLowerCase())
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 4);
}

function itemTitle(item: RecallMediaItem) {
  return item.metadata.search?.description || item.metadata.asset?.filename || item.id;
}

function itemDateLabel(item: RecallMediaItem) {
  return item.metadata.capture?.date ?? item.metadata.capture?.year_month ?? null;
}

function durationLabel(seconds?: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function PhoneViewportFrame({ currentTarget, onSelectCandidate, onConfirmAnswer }: PhoneViewportFrameProps) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<RecallMediaItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SEARCH_BATCH_SIZE);
  const [mode, setMode] = useState<PhoneMode>("home");
  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);
  const [tapRipples, setTapRipples] = useState<TapRipple[]>([]);

  // Track in-flight search abort controller so we can cancel stale requests
  const searchAbortRef = useRef<AbortController | null>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const prevModeRef = useRef<PhoneMode>("home");
  const nextRippleIdRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setDetailItem(null);
    setSelectedItems([]);
    setMode((existingMode) => (existingMode === "detail" ? "home" : existingMode));
  }, [currentTarget?.id]);

  useEffect(() => {
    const controller = new AbortController();
    listRecentItems(SEARCH_BATCH_SIZE, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.results.length > 0) {
          setResults(response.results);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, index) => makeMockItem(`recent-${index}`)));
      });
    return () => { controller.abort(); };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSuggestions(history.slice(0, 5));
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggestSearches(q, 6, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          const nextSuggestions = [...response.suggestions, ...localSuggestions(q, history)];
          setSuggestions(
            nextSuggestions
              .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
              .slice(0, 6),
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions(localSuggestions(q, history));
        });
    }, 140);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [history, query]);

  useEffect(() => {
    const q = query.trim();
    if (!q || mode === "detail") return;

    const timer = window.setTimeout(() => {
      void runSearch(q, SEARCH_BATCH_SIZE, { remember: false });
    }, 500);

    return () => window.clearTimeout(timer);
    // runSearch is stable via useCallback; mode and query are the real deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  useEffect(() => {
    if (prevModeRef.current === "home" && (mode === "typing" || mode === "results")) {
      topBarInputRef.current?.focus();
    }
    prevModeRef.current = mode;
  }, [mode]);

  const runSearch = useCallback(async (
    rawQuery: string,
    count = SEARCH_BATCH_SIZE,
    options: { remember: boolean } = { remember: true },
  ) => {
    const q = rawQuery.trim();
    if (!q) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setIsLoading(false);
      setSubmittedQuery("");
      setResults([]);
      setMode("home");
      return;
    }

    // Cancel any previous in-flight search
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsLoading(true);
    setErrorMessage(null);
    setResults([]);
    setMode("results");
    setSubmittedQuery(q);
    setVisibleCount(count);

    try {
      const [semanticResponse, textResponse] = await Promise.allSettled([
        searchSemantic(q, count, { signal: controller.signal }),
        searchText(q, Math.min(count, 30), { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;

      const semanticResults = semanticResponse.status === "fulfilled" ? semanticResponse.value.results : [];
      const textResults = textResponse.status === "fulfilled" ? textResponse.value.results : [];
      const nextResults = mergeResults(semanticResults, textResults).slice(0, count);

      if (nextResults.length > 0) {
        setResults(nextResults);
      } else if (semanticResponse.status === "rejected" && textResponse.status === "rejected") {
        setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, index) => makeMockItem(`${q}-${index}`, q)));
        setErrorMessage("Backend unavailable. Showing sample tiles until the media bundle is indexed.");
      } else {
        setResults([]);
      }

      if (options.remember) {
        rememberSearch(q);
        setHistory(readSearchHistory());
      }
    } finally {
      if (!controller.signal.aborted && searchAbortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  const runSimilarSearch = useCallback(async (item: RecallMediaItem) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsLoading(true);
    setErrorMessage(null);
    setResults([]);
    setMode("results");
    setDetailItem(null);
    setSubmittedQuery("similar items");
    setQuery("");

    try {
      const response = await searchSimilarById(item.id, SEARCH_BATCH_SIZE, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(response.results);
    } catch {
      if (controller.signal.aborted) return;
      setErrorMessage("Similar search is available after this item has an indexed embedding.");
      setResults([]);
    } finally {
      if (!controller.signal.aborted && searchAbortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  const openDetail = useCallback((item: RecallMediaItem) => {
    setDetailItem(item);
    setMode("detail");
    onSelectCandidate?.(item.id);
  }, [onSelectCandidate]);

  const toggleSelected = useCallback((item: RecallMediaItem) => {
    setSelectedItems((existing) => {
      if (existing.some((candidate) => candidate.id === item.id)) {
        return existing.filter((candidate) => candidate.id !== item.id);
      }
      return [...existing, item];
    });
  }, []);

  const searchSameDate = useCallback((item: RecallMediaItem) => {
    const date = itemDateLabel(item);
    if (!date) {
      setErrorMessage("This item has no date metadata yet.");
      setMode("results");
      setDetailItem(null);
      return;
    }

    setQuery(date);
    void runSearch(date, SEARCH_BATCH_SIZE);
    setDetailItem(null);
  }, [runSearch]);

  const sendSelection = useCallback((item?: RecallMediaItem) => {
    const nextSelection = item && !selectedItems.some((candidate) => candidate.id === item.id)
      ? [...selectedItems, item]
      : selectedItems;
    setSelectedItems(nextSelection);
  }, [selectedItems]);

  const removeHistoryItem = useCallback((item: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.toLowerCase() !== item.toLowerCase());
      writeSearchHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    writeSearchHistory([]);
  }, []);

  const abortActiveSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setIsLoading(false);
  }, []);

  const spawnRipple = useCallback((clientX: number, clientY: number) => {
    const id = ++nextRippleIdRef.current;
    setTapRipples((prev) => [...prev, { id, clientX, clientY }]);
    setTimeout(() => setTapRipples((prev) => prev.filter((r) => r.id !== id)), 600);
  }, []);

  const handlePhonePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    spawnRipple(e.clientX, e.clientY);
  }, [spawnRipple]);

  const handleItemPointerDown = useCallback((e: React.PointerEvent, item: RecallMediaItem) => {
    e.stopPropagation();
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    spawnRipple(e.clientX, e.clientY);
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      openDetail(item);
    }, 500);
  }, [spawnRipple, openDetail]);

  const handleItemPointerUp = useCallback((_e: React.PointerEvent, item: RecallMediaItem) => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!longPressTriggeredRef.current) {
      toggleSelected(item);
    }
    pointerDownPosRef.current = null;
  }, [toggleSelected]);

  const handleItemPointerMove = useCallback((e: React.PointerEvent) => {
    if (longPressTimerRef.current !== null && pointerDownPosRef.current) {
      const dx = e.clientX - pointerDownPosRef.current.x;
      const dy = e.clientY - pointerDownPosRef.current.y;
      if (dx * dx + dy * dy > 64) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  const handleItemPointerCancel = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerDownPosRef.current = null;
  }, []);

  const refinements = useMemo(() => refinementSuggestions(submittedQuery || query, results), [submittedQuery, query, results]);
  const hasMore = results.length >= visibleCount && mode === "results";

  return (
    <div className="phone-stage">
      <div className="phone-rect" aria-label="Phone interface viewport">
        <div className="phone-rect-content" onPointerDown={handlePhonePointerDown}>
          {tapRipples.map((r) => (
            <div
              key={r.id}
              className="tap-ripple"
              style={{ top: r.clientY - 28, left: r.clientX - 28 }}
            />
          ))}
          {mode === "home" ? (
            <div className="phone-startpage">
              <div className="phone-startpage-brand">
                <div className="phone-startpage-logo" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </div>
                <h1 className="phone-startpage-title">Recall</h1>
              </div>

              <div className="phone-startpage-search">
                <div className="search-bar search-bar--semantic search-bar--hero">
                  <span className="search-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <input
                    aria-label="Search your media"
                    value={query}
                    placeholder="Describe a photo, video, or meme…"
                    autoComplete="off"
                    onChange={(event) => {
                      const nextQuery = event.target.value;
                      setQuery(nextQuery);
                      if (nextQuery.trim()) setMode("typing");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runSearch(query);
                    }}
                  />
                  {query ? (
                    <button
                      className="clear-search-btn"
                      type="button"
                      onClick={() => { abortActiveSearch(); setQuery(""); setSubmittedQuery(""); }}
                      aria-label="Clear search"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>

              {history.length > 0 && (
                <div className="phone-history-section">
                  <div className="phone-history-header">
                    <span className="phone-history-header-label">Recent</span>
                    <button className="phone-history-clear-btn" type="button" onClick={clearHistory}>
                      Clear all
                    </button>
                  </div>
                  <ul className="phone-history-list">
                    {history.map((item) => (
                      <li key={item} className="phone-history-row">
                        <button
                          className="phone-history-item"
                          type="button"
                          onClick={() => { setQuery(item); void runSearch(item); }}
                        >
                          <span className="phone-history-icon" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              <path d="M4 12a8 8 0 1 0 2.1-5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </span>
                          <span>{item}</span>
                        </button>
                        <button
                          className="phone-history-remove"
                          type="button"
                          onClick={() => removeHistoryItem(item)}
                          aria-label={`Remove ${item}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          ) : mode !== "detail" ? (
            <div className="mobile-top">
              <div className="search-bar search-bar--semantic">
                <button className="history-btn" type="button" aria-label="Recent searches">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4.9 8.7A8 8 0 1 1 4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M4 5v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <span className="search-icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <input
                  ref={topBarInputRef}
                  aria-label="Search your media"
                  value={query}
                  placeholder="Describe a photo, video, or meme"
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    setQuery(nextQuery);
                    setMode(nextQuery.trim() ? "typing" : "home");
                  }}
                  onFocus={() => setMode(query.trim() ? "typing" : "home")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch(query);
                    }
                  }}
                />
                {query ? (
                  <button
                    className="clear-search-btn"
                    type="button"
                    onClick={() => {
                      abortActiveSearch();
                      setQuery("");
                      setSubmittedQuery("");
                      setMode("home");
                    }}
                    aria-label="Clear search"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>

            </div>
          ) : null}

          {(mode === "typing" || mode === "results") && suggestions.length > 0 && (
            <div className="suggestions">
              <ul>
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      className="suggestion-item"
                      type="button"
                      onClick={() => {
                        setQuery(suggestion);
                        void runSearch(suggestion);
                      }}
                    >
                      <span className="suggestion-icon" aria-hidden>
                        {history.some((item) => item.toLowerCase() === suggestion.toLowerCase()) ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <path d="M4 12a8 8 0 1 0 2.1-5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        )}
                      </span>
                      <span>{suggestion}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(mode === "results" || mode === "typing") && (
            <div className="grid-wrap">
              {submittedQuery && mode === "results" ? (
                <div className="result-context">
                  <span>{isLoading && results.length === 0 ? "Searching…" : `${results.length} candidates`}</span>
                  <strong>{submittedQuery}</strong>
                </div>
              ) : null}
              {errorMessage ? <div className="search-notice">{errorMessage}</div> : null}

              <div className="grid">
                {isLoading && results.length === 0 ? (
                  Array.from({ length: 51 }, (_, i) => (
                    <div key={i} className="thumb-skeleton" aria-hidden="true" />
                  ))
                ) : results.length === 0 ? (
                  <div className="search-empty">No results</div>
                ) : results.map((result) => {
                  const thumb = resolvedThumbnailUrl(result) ?? result.links?.thumbnail ?? result.links?.media;
                  const selected = selectedItems.some((item) => item.id === result.id);
                  const video = isVideo(result);
                  return (
                    <button
                      key={result.id}
                      className={`thumb ${selected ? "thumb--selected" : ""}`}
                      type="button"
                      onPointerDown={(e) => handleItemPointerDown(e, result)}
                      onPointerUp={(e) => handleItemPointerUp(e, result)}
                      onPointerMove={handleItemPointerMove}
                      onPointerCancel={handleItemPointerCancel}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSelected(result); } }}
                      aria-label={`${selected ? "Deselect" : "Select"} ${itemTitle(result)}`}
                      aria-pressed={selected}
                    >
                      {thumb ? <img src={thumb} alt={result.metadata.search?.description ?? ""} loading="lazy" decoding="async" /> : <span className="thumb-fallback" />}
                      {video ? (
                        <span className="video-badge">
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <path d="M3.5 2.5v7l6-3.5-6-3.5z" fill="currentColor" />
                          </svg>
                          {durationLabel(result.metadata.asset?.duration_seconds) ?? "video"}
                        </span>
                      ) : null}
                      {selected ? (
                        <span className="selected-num" aria-hidden>
                          {selectedItems.findIndex((i) => i.id === result.id) + 1}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {mode === "results" && !isLoading ? (
                <div className="results-footer-card">
                  {hasMore ? (
                    <button
                      className="footer-action"
                      type="button"
                      onClick={() => void runSearch(submittedQuery || query, visibleCount + SEARCH_BATCH_SIZE)}
                    >
                      Show more results
                    </button>
                  ) : null}
                  {refinements.length > 0 ? (
                    <div className="refinement-row">
                      <span>Did you mean</span>
                      {refinements.map((refinement) => (
                        <button
                          key={refinement}
                          className="refinement-chip"
                          type="button"
                          onClick={() => {
                            setQuery(refinement);
                            void runSearch(refinement);
                          }}
                        >
                          {refinement}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {mode === "detail" && detailItem && (
            <div className="detail-screen">
              <div className="detail-media-fill">
                {isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
                  <video src={resolvedMediaUrl(detailItem) ?? undefined} poster={resolvedThumbnailUrl(detailItem) ?? undefined} controls muted />
                ) : (
                  <img src={resolvedMediaUrl(detailItem) ?? detailItem.links?.media ?? detailItem.links?.thumbnail} alt={itemTitle(detailItem)} />
                )}
              </div>

              <div className="detail-float-top">
                <button className="detail-float-btn" type="button" onClick={() => setMode("results")} aria-label="Back to results">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {itemDateLabel(detailItem) ? (
                  <div className="detail-float-info">
                    <span>{itemDateLabel(detailItem)}</span>
                  </div>
                ) : null}
              </div>

              <div className="detail-float-bottom">
                <button className="detail-float-action" type="button" onClick={() => searchSameDate(detailItem)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M3 8h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <span>Same Date</span>
                </button>
                <button className="detail-float-action" type="button" onClick={() => void runSimilarSearch(detailItem)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <span>Similar</span>
                </button>
                {onConfirmAnswer ? (
                  <button className="detail-float-action detail-float-action--primary" type="button" onClick={() => onConfirmAnswer(detailItem.id)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Confirm Answer</span>
                  </button>
                ) : (
                  <button className="detail-float-action detail-float-action--primary" type="button" onClick={() => sendSelection(detailItem)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M22 2 11 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      <path d="M22 2 15 22l-4-9-9-4L22 2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Send</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedItems.length > 0 && (
            <div className="selection-tray" aria-live="polite">
              <div className="selection-thumbs">
                {selectedItems.slice(0, 4).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="selection-thumb-btn"
                    onClick={() => toggleSelected(item)}
                    aria-label={`Remove ${itemTitle(item)} from selection`}
                  >
                    <span className="selection-thumb-x" aria-hidden>
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                        <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </span>
                    <img src={resolvedThumbnailUrl(item) ?? item.links?.thumbnail ?? item.links?.media} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
              <span>{selectedItems.length} selected</span>
              <button
                className="send-btn"
                type="button"
                onClick={() => {
                  if (onConfirmAnswer && selectedItems.length > 0) {
                    onConfirmAnswer(selectedItems[0].id);
                  }
                  setSelectedItems([]);
                }}
              >
                {onConfirmAnswer ? "Confirm" : "Send"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
