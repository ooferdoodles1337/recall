import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  HistoryIcon,
  ImageOffIcon,
  InfoIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecallMediaItem, RecallSearchResult } from "@/shared/types/recall";
import { isVideo, resolvedMediaUrl, resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import {
  listRecentItems,
  searchSemantic,
  searchSimilarById,
  searchText,
  suggestSearches,
} from "../api/searchApi";

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
	                  <SearchIcon />
	                </div>
	                <h1 className="phone-startpage-title">Recall</h1>
	              </div>

	              <div className="phone-startpage-search">
	                <div className="search-bar search-bar--semantic search-bar--hero">
	                  <span className="search-icon" aria-hidden>
	                    <SearchIcon />
	                  </span>
	                  <Input
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
	                    <Button
	                      className="clear-search-btn"
	                      variant="ghost"
	                      size="icon-sm"
	                      type="button"
	                      onClick={() => { abortActiveSearch(); setQuery(""); setSubmittedQuery(""); }}
	                      aria-label="Clear search"
	                    >
	                      <XIcon />
	                    </Button>
	                  ) : null}
	                </div>
	              </div>

              {history.length > 0 && (
	                <div className="phone-history-section">
	                  <div className="phone-history-header">
	                    <span className="phone-history-header-label">Recent</span>
	                    <Button
	                      className="phone-history-clear-btn h-auto"
	                      type="button"
	                      variant="ghost"
	                      size="xs"
	                      onClick={clearHistory}
	                    >
	                      Clear all
	                    </Button>
	                  </div>
	                  <Card className="phone-history-list" size="sm">
	                    <CardContent className="p-0">
	                      <ul>
	                        {history.map((item) => (
	                          <li key={item} className="phone-history-row">
	                            <Button
	                              className="phone-history-item h-auto justify-start"
	                              type="button"
	                              variant="ghost"
	                              onClick={() => { setQuery(item); void runSearch(item); }}
	                            >
	                              <span className="phone-history-icon" aria-hidden>
	                                <ClockIcon />
	                              </span>
	                              <span>{item}</span>
	                            </Button>
	                            <Button
	                              className="phone-history-remove"
	                              type="button"
	                              variant="ghost"
	                              size="icon-sm"
	                              onClick={() => removeHistoryItem(item)}
	                              aria-label={`Remove ${item}`}
	                            >
	                              <XIcon />
	                            </Button>
	                          </li>
	                        ))}
	                      </ul>
	                    </CardContent>
	                  </Card>
	                </div>
	              )}

            </div>
	          ) : mode !== "detail" ? (
	            <div className="mobile-top">
	              <div className="search-bar search-bar--semantic">
	                <Button className="history-btn" type="button" variant="ghost" size="icon-sm" aria-label="Recent searches">
	                  <HistoryIcon />
	                </Button>
	                <span className="search-icon" aria-hidden>
	                  <SearchIcon />
	                </span>
	                <Input
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
	                  <Button
	                    className="clear-search-btn"
	                    variant="ghost"
	                    size="icon-sm"
	                    type="button"
	                    onClick={() => {
	                      abortActiveSearch();
                      setQuery("");
                      setSubmittedQuery("");
                      setMode("home");
	                    }}
	                    aria-label="Clear search"
	                  >
	                    <XIcon />
	                  </Button>
	                ) : null}
	              </div>

            </div>
          ) : null}

	          {(mode === "typing" || mode === "results") && suggestions.length > 0 && (
	            <Card className="suggestions" size="sm">
	              <CardContent className="p-0">
	                <ul>
	                  {suggestions.map((suggestion) => {
	                    const fromHistory = history.some((item) => item.toLowerCase() === suggestion.toLowerCase());
	                    return (
	                      <li key={suggestion}>
	                        <Button
	                          className="suggestion-item h-auto justify-start"
	                          type="button"
	                          variant="ghost"
	                          onClick={() => {
	                            setQuery(suggestion);
	                            void runSearch(suggestion);
	                          }}
	                        >
	                          <span className="suggestion-icon" aria-hidden>
	                            {fromHistory ? <ClockIcon /> : <SearchIcon />}
	                          </span>
	                          <span>{suggestion}</span>
	                        </Button>
	                      </li>
	                    );
	                  })}
	                </ul>
	              </CardContent>
	            </Card>
	          )}

          {(mode === "results" || mode === "typing") && (
	            <div className="grid-wrap">
	              {submittedQuery && mode === "results" ? (
	                <div className="result-context">
	                  <strong>{submittedQuery}</strong>
	                </div>
	              ) : null}
	              {errorMessage ? (
	                <Alert variant="destructive" className="search-notice">
	                  <InfoIcon />
	                  <AlertDescription>{errorMessage}</AlertDescription>
	                </Alert>
	              ) : null}

	              <div className="grid">
	                {isLoading && results.length === 0 ? (
	                  Array.from({ length: 51 }, (_, i) => (
	                    <Skeleton key={i} className="thumb-skeleton" aria-hidden="true" />
	                  ))
	                ) : results.length === 0 ? (
	                  <Empty className="search-empty">
	                    <EmptyHeader>
	                      <EmptyMedia variant="icon">
	                        <ImageOffIcon />
	                      </EmptyMedia>
	                      <EmptyTitle>No results</EmptyTitle>
	                      <EmptyDescription>Try another description.</EmptyDescription>
	                    </EmptyHeader>
	                  </Empty>
	                ) : results.map((result) => {
	                  const thumb = resolvedThumbnailUrl(result) ?? result.links?.thumbnail ?? result.links?.media;
	                  const selected = selectedItems.some((item) => item.id === result.id);
	                  const video = isVideo(result);
	                  return (
	                    <Button
	                      key={result.id}
	                      className={`thumb h-auto ${selected ? "thumb--selected" : ""}`}
	                      type="button"
	                      variant="ghost"
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
	                        <Badge variant="secondary" className="video-badge">
	                          <PlayIcon />
	                          {durationLabel(result.metadata.asset?.duration_seconds) ?? "video"}
	                        </Badge>
	                      ) : null}
	                      {selected ? (
	                        <Badge variant="default" className="selected-num" aria-hidden>
	                          {selectedItems.findIndex((i) => i.id === result.id) + 1}
	                        </Badge>
	                      ) : null}
	                    </Button>
	                  );
	                })}
	              </div>

	              {mode === "results" && !isLoading ? (
	                <Card className="results-footer-card" size="sm">
	                  <CardContent className="results-footer-content p-0">
	                  {hasMore ? (
	                    <Button
	                      className="footer-action h-auto"
	                      type="button"
	                      variant="outline"
	                      onClick={() => void runSearch(submittedQuery || query, visibleCount + SEARCH_BATCH_SIZE)}
		                    >
		                      <SparklesIcon data-icon="inline-start" />
		                      Show more results
		                    </Button>
		                  ) : null}
		                  {hasMore && refinements.length > 0 ? <Separator className="results-footer-separator" /> : null}
		                  {refinements.length > 0 ? (
	                    <div className="refinement-row">
	                      <span>Did you mean</span>
	                      {refinements.map((refinement) => (
	                        <Button
	                          key={refinement}
	                          className="refinement-chip h-auto"
	                          type="button"
	                          variant="outline"
	                          onClick={() => {
	                            setQuery(refinement);
	                            void runSearch(refinement);
	                          }}
	                        >
	                          {refinement}
	                        </Button>
	                      ))}
	                    </div>
	                  ) : null}
	                  </CardContent>
	                </Card>
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
	                <Button
	                  className="detail-float-btn"
	                  type="button"
	                  variant="ghost"
	                  size="icon-sm"
	                  onClick={() => setMode("results")}
	                  aria-label="Back to results"
	                >
	                  <ChevronLeftIcon />
	                </Button>
	                {itemDateLabel(detailItem) ? (
	                  <Badge variant="outline" className="detail-float-info">
	                    <span>{itemDateLabel(detailItem)}</span>
	                  </Badge>
	                ) : null}
	              </div>

	              <div className="detail-float-bottom">
	                <Button
	                  className="detail-float-action h-auto"
	                  type="button"
	                  variant="ghost"
	                  onClick={() => searchSameDate(detailItem)}
	                >
	                  <CalendarIcon data-icon="inline-start" />
	                  <span>Same Date</span>
	                </Button>
	                <Button
	                  className="detail-float-action h-auto"
	                  type="button"
	                  variant="ghost"
	                  onClick={() => void runSimilarSearch(detailItem)}
	                >
	                  <SearchIcon data-icon="inline-start" />
	                  <span>Similar</span>
	                </Button>
	                {onConfirmAnswer ? (
	                  <Button
	                    className="detail-float-action detail-float-action--primary h-auto"
	                    type="button"
	                    onClick={() => onConfirmAnswer(detailItem.id)}
	                  >
	                    <CheckIcon data-icon="inline-start" />
	                    <span>Confirm Answer</span>
	                  </Button>
	                ) : (
	                  <Button
	                    className="detail-float-action detail-float-action--primary h-auto"
	                    type="button"
	                    onClick={() => sendSelection(detailItem)}
	                  >
	                    <SendIcon data-icon="inline-start" />
	                    <span>Send</span>
	                  </Button>
	                )}
	              </div>
            </div>
          )}

		          {selectedItems.length > 0 && mode !== "detail" && (
	            <Card className="selection-tray" aria-live="polite" size="sm">
	              <CardContent className="selection-tray-content p-0">
	                <div className="selection-thumbs">
	                  {selectedItems.slice(0, 4).map((item) => (
	                    <Button
	                      key={item.id}
	                      type="button"
	                      variant="ghost"
	                      size="icon-sm"
	                      className="selection-thumb-btn"
	                      onClick={() => toggleSelected(item)}
	                      aria-label={`Remove ${itemTitle(item)} from selection`}
	                    >
	                      <span className="selection-thumb-x" aria-hidden>
	                        <XIcon />
	                      </span>
	                      <img src={resolvedThumbnailUrl(item) ?? item.links?.thumbnail ?? item.links?.media} alt="" loading="lazy" decoding="async" />
	                    </Button>
	                  ))}
	                </div>
	                <Badge variant="secondary" className="selection-count">{selectedItems.length} selected</Badge>
	                <Button
	                  className="send-btn h-auto"
	                  type="button"
	                  onClick={() => {
	                    if (onConfirmAnswer && selectedItems.length > 0) {
	                      onConfirmAnswer(selectedItems[0].id);
	                    }
	                    setSelectedItems([]);
	                  }}
	                >
	                  {onConfirmAnswer ? (
	                    <CheckIcon data-icon="inline-start" />
	                  ) : (
	                    <SendIcon data-icon="inline-start" />
	                  )}
	                  {onConfirmAnswer ? "Confirm" : "Send"}
	                </Button>
	              </CardContent>
	            </Card>
	          )}
        </div>
      </div>
    </div>
  );
}
