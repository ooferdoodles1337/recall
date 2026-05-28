import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  HistoryIcon,
  ImageOffIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  UserIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecallMediaItem, RecallSearchResult } from "@/shared/types/recall";
import { isAnimatedImage, isVideo, resolvedAnimatedThumbnailUrl, resolvedMediaUrl, resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import {
  listFavoriteItems,
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
type SearchIntent = "preview" | "commit";

const SEARCH_BATCH_SIZE = 51;
const FAVORITES_COUNT = 34;
const SEARCH_HISTORY_KEY = "recall.searchHistory.v1";
const OVERSCROLL_THRESHOLD = 80;


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

function playbackTimeLabel(seconds: number) {
  return durationLabel(seconds) ?? "0:00";
}

interface ThumbCellProps {
  result: RecallMediaItem;
  selected: boolean;
  selectionIndex: number;
  onPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
}

const ThumbCell = React.memo(function ThumbCell({ result, selected, selectionIndex, onPointerDown, onPointerUp, onPointerMove, onPointerCancel, toggleSelected }: ThumbCellProps) {
  const [staticLoaded, setStaticLoaded] = useState(false);
  const thumb = resolvedThumbnailUrl(result) ?? result.links?.thumbnail ?? result.links?.media;
  const animatedThumb = resolvedAnimatedThumbnailUrl(result);
  const video = isVideo(result);
  const animated = isAnimatedImage(result);
  return (
    <Button
      className={`thumb h-auto ${selected ? "thumb--selected" : ""}`}
      type="button"
      variant="ghost"
      onPointerDown={(e) => onPointerDown(e, result)}
      onPointerUp={(e) => onPointerUp(e, result)}
      onPointerMove={onPointerMove}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSelected(result); } }}
      aria-label={`${selected ? "Deselect" : "Select"} ${itemTitle(result)}`}
      aria-pressed={selected}
    >
      {thumb ? (
        <div className="thumb-img-wrap">
          <img src={thumb} alt={result.metadata.search?.description ?? ""} loading="lazy" decoding="async" onLoad={() => setStaticLoaded(true)} />
          {staticLoaded && animatedThumb ? (
            <img src={animatedThumb} alt="" aria-hidden loading="lazy" decoding="async" className="thumb-animated" onLoad={(e) => { e.currentTarget.style.opacity = "1"; }} />
          ) : null}
        </div>
      ) : <span className="thumb-fallback" />}
      {video ? (
        <Badge variant="secondary" className="video-badge">
          <PlayIcon />
          {durationLabel(result.metadata.asset?.duration_seconds) ?? "video"}
        </Badge>
      ) : animated ? (
        <Badge variant="secondary" className="video-badge video-badge--gif">GIF</Badge>
      ) : null}
      {selected ? (
        <Badge variant="default" className="selected-num" aria-hidden>{selectionIndex + 1}</Badge>
      ) : null}
    </Button>
  );
});

interface VideoDetailViewProps {
  item: RecallMediaItem;
  onBack: () => void;
  onSearchSameDate: (item: RecallMediaItem) => void;
  onRunSimilarSearch: (item: RecallMediaItem) => void;
  onConfirmAnswer?: (id: string) => void;
  onSendSelection: (item: RecallMediaItem) => void;
}

function VideoDetailView({
  item,
  onBack,
  onSearchSameDate,
  onRunSimilarSearch,
  onConfirmAnswer,
  onSendSelection,
}: VideoDetailViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.metadata.asset?.duration_seconds ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const mediaUrl = resolvedMediaUrl(item);
  const posterUrl = resolvedThumbnailUrl(item) ?? undefined;

  const clearChromeTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearChromeTimer();
    if (!isPlaying || isScrubbing) return;
    hideTimerRef.current = setTimeout(() => {
      setChromeVisible(false);
      hideTimerRef.current = null;
    }, 2400);
  }, [clearChromeTimer, isPlaying, isScrubbing]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(item.metadata.asset?.duration_seconds ?? 0);
    setIsPlaying(false);
    setIsScrubbing(false);
    setChromeVisible(true);
    clearChromeTimer();
  }, [clearChromeTimer, item.id, item.metadata.asset?.duration_seconds]);

  useEffect(() => {
    scheduleChromeHide();
    return clearChromeTimer;
  }, [clearChromeTimer, scheduleChromeHide]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setChromeVisible(true);
    if (video.paused) {
      void video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration)) {
      setDuration(video.duration);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || isScrubbing) return;
    setCurrentTime(video.currentTime);
  }, [isScrubbing]);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    if (!Number.isFinite(nextTime)) return;
    setCurrentTime(nextTime);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
  }, []);

  const startScrubbing = useCallback(() => {
    clearChromeTimer();
    setIsScrubbing(true);
    setChromeVisible(true);
  }, [clearChromeTimer]);

  const stopScrubbing = useCallback(() => {
    setIsScrubbing(false);
  }, []);

  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => !visible);
  }, []);

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const timelineMax = Math.max(duration, 0.01);

  if (!mediaUrl) {
    return null;
  }

  return (
    <div
      className={`detail-screen detail-screen--video ${chromeVisible ? "detail-screen--chrome-visible" : "detail-screen--chrome-hidden"}${isScrubbing ? " detail-screen--scrubbing" : ""}`}
    >
      <div className="detail-media-fill detail-media-fill--video">
        <video
          ref={videoRef}
          src={mediaUrl}
          poster={posterUrl}
          muted
          playsInline
          preload="metadata"
          onClick={toggleChrome}
          onContextMenu={(e) => e.preventDefault()}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => { setIsPlaying(false); setChromeVisible(true); }}
          onEnded={() => { setIsPlaying(false); setChromeVisible(true); }}
        />
      </div>

      <div className="detail-float-top video-chrome">
        <Button
          className="detail-float-btn"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeftIcon />
        </Button>
        {itemDateLabel(item) ? (
          <Badge variant="outline" className="detail-float-info">
            <span>{itemDateLabel(item)}</span>
          </Badge>
        ) : null}
      </div>

      <div className="video-control-panel video-chrome" onPointerMove={revealChrome}>
        <div className="video-action-row">
          <Button
            className="detail-float-action h-auto"
            type="button"
            variant="ghost"
            onClick={() => onSearchSameDate(item)}
          >
            <CalendarIcon data-icon="inline-start" />
            <span>Same Date</span>
          </Button>
          <Button
            className="detail-float-action h-auto"
            type="button"
            variant="ghost"
            onClick={() => onRunSimilarSearch(item)}
          >
            <SearchIcon data-icon="inline-start" />
            <span>Similar</span>
          </Button>
          {onConfirmAnswer ? (
            <Button
              className="detail-float-action detail-float-action--primary h-auto"
              type="button"
              onClick={() => onConfirmAnswer(item.id)}
            >
              <CheckIcon data-icon="inline-start" />
              <span>Confirm</span>
            </Button>
          ) : (
            <Button
              className="detail-float-action detail-float-action--primary h-auto"
              type="button"
              onClick={() => onSendSelection(item)}
            >
              <SendIcon data-icon="inline-start" />
              <span>Send</span>
            </Button>
          )}
        </div>

        <div className="video-timeline">
          <Button
            className="video-play-btn"
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause video" : "Play video"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <span className="video-time video-time--elapsed">{playbackTimeLabel(currentTime)}</span>
          <input
            className="video-scrubber"
            type="range"
            min="0"
            max={timelineMax}
            step="0.01"
            value={Math.min(currentTime, timelineMax)}
            aria-label="Video timeline"
            aria-valuetext={`${playbackTimeLabel(currentTime)} of ${playbackTimeLabel(duration)}`}
            style={{ "--video-progress": `${progress}%` } as React.CSSProperties}
            onChange={handleSeek}
            onPointerDown={startScrubbing}
            onPointerUp={stopScrubbing}
            onPointerCancel={stopScrubbing}
            onTouchEnd={stopScrubbing}
            onMouseUp={stopScrubbing}
          />
          <span className="video-time video-time--duration">{playbackTimeLabel(duration)}</span>
        </div>
      </div>
    </div>
  );
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
  const [showHistory, setShowHistory] = useState(false);
  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<RecallMediaItem[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const prevModeRef = useRef<PhoneMode>("home");
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const hasPrefetchedRef = useRef(false);
  const detailReturnModeRef = useRef<Exclude<PhoneMode, "detail">>("results");
  const liveRef = useRef({ hasMore: false, submittedQuery: "", query: "", visibleCount: SEARCH_BATCH_SIZE, prefetchedResults: null as RecallMediaItem[] | null });
  const [prefetchedResults, setPrefetchedResults] = useState<RecallMediaItem[] | null>(null);
  const [overscrollProgress, setOverscrollProgress] = useState(0);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
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
    const controller = new AbortController();
    setIsLoadingFavorites(true);

    listFavoriteItems(FAVORITES_COUNT, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setFavoriteItems(response.results);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFavoriteItems([]);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsLoadingFavorites(false);
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
    if (!q || mode !== "typing") return;

    const timer = window.setTimeout(() => {
      void runSearch(q, SEARCH_BATCH_SIZE, { intent: "preview" });
    }, 500);

    return () => window.clearTimeout(timer);
    // runSearch is stable via useCallback; mode and query control preview scheduling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query]);

  useEffect(() => {
    if (prevModeRef.current === "home" && (mode === "typing" || mode === "results")) {
      topBarInputRef.current?.focus();
    }
    prevModeRef.current = mode;
  }, [mode]);

  const runSearch = useCallback(async (
    rawQuery: string,
    count = SEARCH_BATCH_SIZE,
    options: { remember?: boolean; intent?: SearchIntent } = {},
  ) => {
    const q = rawQuery.trim();
    const intent = options.intent ?? "commit";
    const isPreview = intent === "preview";
    const shouldRemember = options.remember ?? !isPreview;

    if (!q) {
      if (!isPreview) {
        searchAbortRef.current?.abort();
        searchAbortRef.current = null;
        setIsLoading(false);
        setSubmittedQuery("");
        setResults([]);
        setMode("home");
      }
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    setIsLoadingMore(false);
    setIsLoading(true);
    setErrorMessage(null);
    setResults([]);
    setVisibleCount(count);

    if (!isPreview) {
      setMode("results");
      setSubmittedQuery(q);
    }

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
      } else if (!isPreview && semanticResponse.status === "rejected" && textResponse.status === "rejected") {
        setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, index) => makeMockItem(`${q}-${index}`, q)));
        setErrorMessage("Backend unavailable. Showing sample tiles until the media bundle is indexed.");
      } else {
        setResults([]);
      }

      if (shouldRemember) {
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
    if (mode !== "detail") {
      detailReturnModeRef.current = mode;
    }
    setDetailItem(item);
    setMode("detail");
    onSelectCandidate?.(item.id);
  }, [mode, onSelectCandidate]);

  const closeDetail = useCallback(() => {
    setDetailItem(null);
    setMode(detailReturnModeRef.current);
  }, []);

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

  const prefetchNextBatch = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, visibleCount: vc } = liveRef.current;
    if (!live || hasPrefetchedRef.current || !sq) return;
    hasPrefetchedRef.current = true;
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [semanticResponse, textResponse] = await Promise.allSettled([
        searchSemantic(sq, nextCount, { signal: controller.signal }),
        searchText(sq, Math.min(nextCount, 30), { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const semanticResults = semanticResponse.status === "fulfilled" ? semanticResponse.value.results : [];
      const textResults = textResponse.status === "fulfilled" ? textResponse.value.results : [];
      const nextResults = mergeResults(semanticResults, textResults).slice(0, nextCount);
      if (nextResults.length > 0) setPrefetchedResults(nextResults);
    } catch {
      if (!controller.signal.aborted) hasPrefetchedRef.current = false;
    }
  }, []);

  const loadMore = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, query: q, visibleCount: vc, prefetchedResults: cached } = liveRef.current;
    if (!live) return;

    if (cached) {
      setResults(cached);
      setVisibleCount(vc + SEARCH_BATCH_SIZE);
      setErrorMessage(null);
      setPrefetchedResults(null);
      hasPrefetchedRef.current = false;
      return;
    }

    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setIsLoadingMore(true);

    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [semanticResponse, textResponse] = await Promise.allSettled([
        searchSemantic(sq || q, nextCount, { signal: controller.signal }),
        searchText(sq || q, Math.min(nextCount, 30), { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const semanticResults = semanticResponse.status === "fulfilled" ? semanticResponse.value.results : [];
      const textResults = textResponse.status === "fulfilled" ? textResponse.value.results : [];
      const nextResults = mergeResults(semanticResults, textResults).slice(0, nextCount);
      if (nextResults.length > 0) {
        setResults(nextResults);
        setVisibleCount(nextCount);
      }
    } finally {
      if (!controller.signal.aborted) setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    hasPrefetchedRef.current = false;
    setPrefetchedResults(null);
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;
  }, [submittedQuery]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "results") return;
    const handleScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) void prefetchNextBatch();
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode, prefetchNextBatch]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "typing") return;
    const handleScroll = () => {
      if (el.scrollTop > 10) setMode("results");
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "results") return;
    let hitBottomAtY: number | null = null;
    let touchStartY = 0;
    let currentOverscroll = 0;
    const isAtBottom = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      hitBottomAtY = null;
      currentOverscroll = 0;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const touchY = e.touches[0].clientY;
      if (isAtBottom()) {
        if (hitBottomAtY === null && touchStartY > touchY) hitBottomAtY = touchY;
        if (hitBottomAtY !== null) {
          const delta = Math.max(0, hitBottomAtY - touchY);
          currentOverscroll = delta;
          if (delta > 0) {
            e.preventDefault();
            setOverscrollProgress(Math.min(1, delta / OVERSCROLL_THRESHOLD));
          }
        }
      } else if (currentOverscroll > 0) {
        currentOverscroll = 0;
        hitBottomAtY = null;
        setOverscrollProgress(0);
      }
    };
    const handleTouchEnd = () => {
      const delta = currentOverscroll;
      currentOverscroll = 0;
      setOverscrollProgress(0);
      if (delta >= OVERSCROLL_THRESHOLD && liveRef.current.hasMore) {
        const { prefetchedResults: cached, visibleCount: vc } = liveRef.current;
        if (cached) {
          setResults(cached);
          setVisibleCount(vc + SEARCH_BATCH_SIZE);
          setErrorMessage(null);
          setPrefetchedResults(null);
          hasPrefetchedRef.current = false;
        } else {
          void loadMore();
        }
      }
    };
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleItemPointerDown = useCallback((e: React.PointerEvent, item: RecallMediaItem) => {
    e.stopPropagation();
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      openDetail(item);
    }, 500);
  }, [openDetail]);

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

  const refinements = useMemo(
    () => suggestions.filter((s) => s.toLowerCase() !== submittedQuery.toLowerCase()).slice(0, 4),
    [suggestions, submittedQuery],
  );
  const hasMore = results.length >= visibleCount && mode === "results";
  const showSelectionTray = selectedItems.length > 0 && mode !== "detail";
  const showFavoritesSection = isLoadingFavorites || favoriteItems.length > 0;
  liveRef.current = { hasMore, submittedQuery, query, visibleCount, prefetchedResults };

  return (
    <div className="phone-stage">
      <div className={`phone-rect${showSelectionTray ? " phone-rect--has-selection" : ""}`} aria-label="Phone interface viewport">
        {mode === "results" && hasMore ? (
          <div
            className={`pull-indicator${overscrollProgress > 0 ? " pull-indicator--visible" : ""}${overscrollProgress >= 1 ? " pull-indicator--ready" : ""}`}
            aria-hidden
          >
            <svg className="pull-indicator-ring" viewBox="0 0 20 20">
              <circle className="pull-indicator-track" cx="10" cy="10" r="8" />
              <circle
                className="pull-indicator-fill"
                cx="10" cy="10" r="8"
                style={{ strokeDashoffset: 50.3 * (1 - overscrollProgress) }}
              />
            </svg>
            <span>{overscrollProgress >= 1 ? "Release!" : "More results"}</span>
          </div>
        ) : null}

        {/* Main scrollable content — ScrollArea with forwarded ref for touch/scroll events */}
        <ScrollArea
          className="phone-rect-content"
          viewportRef={scrollContainerRef}
          viewportClassName="phone-rect-viewport"
        >
          {mode === "home" ? (
            <div className="phone-startpage">
              <div className="phone-startpage-header">
                <div className="phone-startpage-brand">
                  <div className="phone-startpage-logo" aria-hidden>
                    <SearchIcon />
                  </div>
                  <h1 className="phone-startpage-title">Recall</h1>
                </div>
                {/* Avatar replaces the disabled ghost icon button */}
                <Avatar className="phone-avatar" aria-label="Profile">
                  <AvatarFallback>
                    <UserIcon className="size-3.5" />
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="phone-startpage-search-sticky">
                <div className="phone-startpage-search">
                  <div className="search-bar search-bar--semantic search-bar--hero">
                    <Button
                      className={`history-btn${showHistory ? " history-btn--active" : ""}`}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Recent searches"
                      aria-pressed={showHistory}
                      onClick={() => setShowHistory((prev) => !prev)}
                    >
                      <HistoryIcon />
                    </Button>
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

                {showHistory && history.length > 0 && (
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
                    {/* Card with Separator between rows instead of CSS border-bottom */}
                    <Card className="phone-history-list" size="sm">
                      <CardContent className="p-0">
                        {history.map((item, idx) => (
                          <React.Fragment key={item}>
                            <div className="phone-history-row">
                              <Button
                                className="phone-history-item h-auto justify-start"
                                type="button"
                                variant="ghost"
                                onClick={() => { setShowHistory(false); setQuery(item); void runSearch(item); }}
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
                            </div>
                            {idx < history.length - 1 ? <Separator className="phone-list-separator" /> : null}
                          </React.Fragment>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>

              {showFavoritesSection ? (
                <section className="phone-favorites-section" aria-labelledby="phone-favorites-title">
                  <div className="phone-favorites-header">
                    <h2 id="phone-favorites-title" className="phone-favorites-title">Favorites</h2>
                    {!isLoadingFavorites ? (
                      <span className="phone-favorites-count">{favoriteItems.length} items</span>
                    ) : null}
                  </div>
                  <div className="grid phone-favorites-grid">
                    {isLoadingFavorites ? (
                      Array.from({ length: 9 }, (_, index) => (
                        <Skeleton key={index} className="thumb-skeleton" aria-hidden="true" />
                      ))
                    ) : favoriteItems.map((result) => (
                      <ThumbCell
                        key={result.id}
                        result={result}
                        selected={selectedItems.some((item) => item.id === result.id)}
                        selectionIndex={selectedItems.findIndex((i) => i.id === result.id)}
                        onPointerDown={handleItemPointerDown}
                        onPointerUp={handleItemPointerUp}
                        onPointerMove={handleItemPointerMove}
                        onPointerCancel={handleItemPointerCancel}
                        toggleSelected={toggleSelected}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

            </div>
          ) : mode !== "detail" ? (
            <div className="mobile-top">
              <div className="search-bar search-bar--semantic">
                <Button
                  className={`history-btn${showHistory ? " history-btn--active" : ""}`}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Recent searches"
                  aria-pressed={showHistory}
                  onClick={() => setShowHistory((prev) => !prev)}
                >
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
                    setShowHistory(false);
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

              {/* History overlay — Separator replaces CSS border-bottom */}
              {showHistory && history.length > 0 ? (
                <Card className="suggestions" size="sm">
                  <CardContent className="p-0">
                    {history.map((item, idx) => (
                      <React.Fragment key={item}>
                        <div className="phone-history-row">
                          <Button
                            className="suggestion-item h-auto justify-start"
                            type="button"
                            variant="ghost"
                            onClick={() => { setShowHistory(false); setQuery(item); void runSearch(item); }}
                          >
                            <span className="suggestion-icon" aria-hidden><ClockIcon /></span>
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
                        </div>
                        {idx < history.length - 1 ? <Separator className="phone-list-separator" /> : null}
                      </React.Fragment>
                    ))}
                  </CardContent>
                </Card>
              ) : mode === "typing" && suggestions.length > 0 ? (
                /* Suggestions list — Separator between rows */
                <Card className="suggestions" size="sm">
                  <CardContent className="p-0">
                    {suggestions.map((suggestion, idx) => {
                      const fromHistory = history.some((item) => item.toLowerCase() === suggestion.toLowerCase());
                      return (
                        <React.Fragment key={suggestion}>
                          <Button
                            className="suggestion-item h-auto justify-start w-full"
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setShowHistory(false);
                              setQuery(suggestion);
                              void runSearch(suggestion);
                            }}
                          >
                            <span className="suggestion-icon" aria-hidden>
                              {fromHistory ? <ClockIcon /> : <SearchIcon />}
                            </span>
                            <span>{suggestion}</span>
                          </Button>
                          {idx < suggestions.length - 1 ? <Separator className="phone-list-separator" /> : null}
                        </React.Fragment>
                      );
                    })}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}

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
                ) : results.length === 0 && mode === "results" ? (
                  <Empty className="search-empty">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ImageOffIcon />
                      </EmptyMedia>
                      <EmptyTitle>No results</EmptyTitle>
                      <EmptyDescription>Try another description.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : results.map((result) => (
                  <ThumbCell
                    key={result.id}
                    result={result}
                    selected={selectedItems.some((item) => item.id === result.id)}
                    selectionIndex={selectedItems.findIndex((i) => i.id === result.id)}
                    onPointerDown={handleItemPointerDown}
                    onPointerUp={handleItemPointerUp}
                    onPointerMove={handleItemPointerMove}
                    onPointerCancel={handleItemPointerCancel}
                    toggleSelected={toggleSelected}
                  />
                ))}
                {isLoadingMore ? (
                  Array.from({ length: 9 }, (_, i) => (
                    <Skeleton key={`more-${i}`} className="thumb-skeleton" aria-hidden="true" />
                  ))
                ) : null}
              </div>

              {mode === "results" && !isLoading ? (
                <Card className="results-footer-card" size="sm">
                  <CardContent className="results-footer-content p-0">
                    {hasMore ? (
                      <Button
                        className="footer-action h-auto"
                        type="button"
                        variant="outline"
                        disabled={isLoadingMore}
                        onClick={() => void loadMore()}
                      >
                        <SparklesIcon data-icon="inline-start" />
                        {isLoadingMore ? "Loading…" : "Show more results"}
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
            isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
              <VideoDetailView
                item={detailItem}
                onBack={closeDetail}
                onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)}
                onConfirmAnswer={onConfirmAnswer}
                onSendSelection={sendSelection}
              />
            ) : (
              <div className="detail-screen">
                <div className="detail-media-fill">
                  <img src={resolvedMediaUrl(detailItem) ?? detailItem.links?.media ?? detailItem.links?.thumbnail} alt={itemTitle(detailItem)} onContextMenu={(e) => e.preventDefault()} />
                </div>

                <div className="detail-float-top">
                  <Button
                    className="detail-float-btn"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={closeDetail}
                    aria-label="Back"
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
            )
          )}

        </ScrollArea>

        {/* Selection tray — floats above the scroll area */}
        {showSelectionTray && (
          <Card className="selection-tray" aria-live="polite" size="sm">
            <CardContent className="selection-tray-content p-0">
              <div className="selection-thumbs" aria-label="Selected items">
                {selectedItems.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    className="selection-thumb-btn h-auto"
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
              <div className="selection-tray-actions">
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
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
