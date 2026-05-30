import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isVideo, resolvedMediaUrl } from "@/shared/media/mediaItem";
import {
  SEARCH_BATCH_SIZE,
  FAVORITES_COUNT,
  OVERSCROLL_THRESHOLD,
  GRID_COLUMN_OPTIONS,
  GRID_GAP_BY_COLUMNS,
  GRID_RADIUS_BY_COLUMNS,
  PHONE_MOTION,
  MOTION_EASE,
  type GridColumns,
  makeMockItem,
  readSearchHistory,
  writeSearchHistory,
  readGridColumns,
  writeGridColumns,
  nearestGridColumns,
  pointerDistance,
  pointerMidpoint,
  reduceMotionEnabled,
  mediaLayoutId,
  rememberSearch,
  mergeResults,
  localSuggestions,
  itemDateLabel,
} from "./phoneUtils";
import { AboutSheet } from "./AboutSheet";
import { PhoneHomeHeader } from "./PhoneHomeHeader";
import { NsfwDialog } from "./NsfwDialog";
import { ImageDetailView } from "./ImageDetailView";
import { SelectionTray } from "./SelectionTray";
import { VideoDetailView } from "./VideoDetailView";
import { FavoritesSection } from "./FavoritesSection";
import { ResultsSection } from "./ResultsSection";
import {
  listFavoriteItems,
  listRecentItems,
  patchCatalogItem,
  searchSemantic,
  searchSimilarById,
  searchText,
  suggestSearches,
} from "../api/searchApi";
import {
  initialPhoneModeState,
  phoneModeReducer,
  type ModeTransition,
  type PhoneScreen,
} from "../phoneReducer";
import { PhoneSearchBar, SearchAssistPanel } from "./SearchCommandLayer";

interface PhoneViewportFrameProps {
  currentTarget?: RecallMediaItem;
  onSelectCandidate?: (id: string) => void;
  onConfirmAnswer?: (id: string) => void;
  onExit?: () => void;
}

type PhoneMode = PhoneScreen;
type GridPoint = { x: number; y: number };
type GridItemSnapshot = Map<string, DOMRect>;
type PinchGesture = {
  startColumns: GridColumns;
  startDistance: number;
  midpoint: GridPoint;
};

const screenMotionVariants = {
  enter: ({ direction, reason }: ModeTransition) => ({
    opacity: 0,
    y: reason === "search-clear" || reason === "autosearch-commit" ? 0 : direction === "back" ? -10 : 14,
    scale: reason === "search-clear" || reason === "autosearch-commit" ? 1 : direction === "back" ? 1.012 : 0.988,
  }),
  center: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: PHONE_MOTION.screenMs / 1000,
      ease: MOTION_EASE.standard,
    },
  },
  exit: ({ direction, reason }: ModeTransition) => ({
    opacity: 0,
    y: reason === "search-clear" || reason === "autosearch-commit" ? 0 : direction === "back" ? 16 : -8,
    scale: reason === "search-clear" ? 0.96 : reason === "autosearch-commit" ? 1 : direction === "back" ? 0.986 : 1.01,
    transition: {
      duration: reason === "search-clear" ? 0.2 : PHONE_MOTION.exitMs / 1000,
      ease: reason === "search-clear" ? ([0.4, 0, 0.2, 1] as [number, number, number, number]) : MOTION_EASE.exit,
    },
  }),
};

function isItemNsfw(item: RecallMediaItem) {
  return item.metadata.safety?.state === "nsfw";
}

export function PhoneViewportFrame({ currentTarget, onSelectCandidate, onConfirmAnswer, onExit }: PhoneViewportFrameProps) {
  const [modeState, dispatch] = useReducer(phoneModeReducer, initialPhoneModeState);
  const mode = modeState.screen;
  const contentMode = modeState.bgContent;
  const modeTransition = modeState.transition;

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<RecallMediaItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SEARCH_BATCH_SIZE);
  const [showHistory, setShowHistory] = useState(false);
  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<RecallMediaItem[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [gridColumns, setGridColumns] = useState<GridColumns>(() => readGridColumns());
  const prefersReducedMotion = useReducedMotion();

  const phoneRectRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<PhoneMode>("home");
  const bgContentRef = useRef(contentMode);
  bgContentRef.current = contentMode;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchGridRef = useRef<HTMLDivElement>(null);
  const favoritesGridRef = useRef<HTMLDivElement>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const hasPrefetchedRef = useRef(false);
  const gridColumnsRef = useRef<GridColumns>(gridColumns);
  const pendingGridSnapshotRef = useRef<GridItemSnapshot | null>(null);
  const gridFlipAnimationsRef = useRef<Animation[]>([]);
  const activeTouchPointersRef = useRef<Map<number, GridPoint>>(new Map());
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const wheelAccumRef = useRef(0);
  const suppressSelectionUntilRef = useRef(0);
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const [isAutoSearchPending, setIsAutoSearchPending] = useState(false);
  const liveRef = useRef({ hasMore: false, submittedQuery: "", query: "", visibleCount: SEARCH_BATCH_SIZE, prefetchedResults: null as RecallMediaItem[] | null });
  const [prefetchedResults, setPrefetchedResults] = useState<RecallMediaItem[] | null>(null);
  const [overscrollProgress, setOverscrollProgress] = useState(0);
  const prevScrollTopRef = useRef(0);
  const [nsfwRevealedIds, setNsfwRevealedIds] = useState<Set<string>>(new Set());
  const [nsfwRevealedAll, setNsfwRevealedAll] = useState(false);
  const [nsfwPendingItem, setNsfwPendingItem] = useState<RecallMediaItem | null>(null);
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);

  const isItemBlurred = useCallback((item: RecallMediaItem) =>
    isItemNsfw(item) && !nsfwRevealedAll && !nsfwRevealedIds.has(item.id),
  [nsfwRevealedAll, nsfwRevealedIds]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
      if (autoSearchTimerRef.current !== null) {
        clearTimeout(autoSearchTimerRef.current);
      }
      gridFlipAnimationsRef.current.forEach((animation) => animation.cancel());
      activeTouchPointersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setDetailItem(null);
    setSelectedItems([]);
    if (modeRef.current === "detail") {
      dispatch({ type: "TARGET_RESET" });
    }
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
    if (mode === "compose") {
      topBarInputRef.current?.focus();
    }
    modeRef.current = mode;
  }, [contentMode, mode]);

  useEffect(() => {
    if (modeTransition.reason === "search-clear") {
      scrollContainerRef.current?.scrollTo({ top: 0 });
    }
  }, [modeTransition]);

  const gridDensityStyle = useMemo(() => ({
    "--phone-grid-columns": String(gridColumns),
    "--phone-grid-gap": GRID_GAP_BY_COLUMNS[gridColumns],
    "--phone-grid-radius": GRID_RADIUS_BY_COLUMNS[gridColumns],
  }) as React.CSSProperties, [gridColumns]);

  useEffect(() => {
    gridColumnsRef.current = gridColumns;
  }, [gridColumns]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerDownPosRef.current = null;
  }, []);

  const suppressTileSelectionBriefly = useCallback(() => {
    const now = typeof window !== "undefined" ? window.performance.now() : Date.now();
    suppressSelectionUntilRef.current = now + 450;
  }, []);

  const isTileSelectionSuppressed = useCallback(() => {
    const now = typeof window !== "undefined" ? window.performance.now() : Date.now();
    return now < suppressSelectionUntilRef.current;
  }, []);

  const captureGridSnapshot = useCallback((): GridItemSnapshot => {
    const snapshot: GridItemSnapshot = new Map();
    const grids = [favoritesGridRef.current, searchGridRef.current];

    for (const grid of grids) {
      if (!grid) continue;

      const scope = grid.dataset.phoneGridScope ?? "grid";
      grid.querySelectorAll<HTMLElement>("[data-phone-grid-item]").forEach((element) => {
        const id = element.dataset.phoneGridItem;
        if (!id) return;
        snapshot.set(`${scope}:${id}`, element.getBoundingClientRect());
      });
    }

    return snapshot;
  }, []);

  const updateGridColumns = useCallback((nextColumns: GridColumns) => {
    const currentColumns = gridColumnsRef.current;
    if (nextColumns === currentColumns) return;

    pendingGridSnapshotRef.current = captureGridSnapshot();
    gridColumnsRef.current = nextColumns;
    writeGridColumns(nextColumns);
    setGridColumns(nextColumns);
  }, [captureGridSnapshot]);

  useLayoutEffect(() => {
    const snapshot = pendingGridSnapshotRef.current;
    if (!snapshot) return;

    pendingGridSnapshotRef.current = null;
    gridFlipAnimationsRef.current.forEach((animation) => animation.cancel());
    gridFlipAnimationsRef.current = [];

    if (snapshot.size === 0 || reduceMotionEnabled()) return;

    const animations: Animation[] = [];
    const grids = [favoritesGridRef.current, searchGridRef.current];

    for (const grid of grids) {
      if (!grid) continue;

      const scope = grid.dataset.phoneGridScope ?? "grid";
      grid.querySelectorAll<HTMLElement>("[data-phone-grid-item]").forEach((element) => {
        const id = element.dataset.phoneGridItem;
        if (!id) return;

        const first = snapshot.get(`${scope}:${id}`);
        if (!first) return;

        const last = element.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        const scaleX = first.width / Math.max(last.width, 1);
        const scaleY = first.height / Math.max(last.height, 1);
        const moved = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
        const scaled = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;

        if (!moved && !scaled) return;

        const animation = element.animate(
          [
            {
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
              transformOrigin: "center",
            },
            {
              transform: "translate(0, 0) scale(1, 1)",
              transformOrigin: "center",
            },
          ],
          {
            duration: 260,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );

        animations.push(animation);
        animation.finished
          .catch(() => undefined)
          .finally(() => {
            gridFlipAnimationsRef.current = gridFlipAnimationsRef.current.filter((existing) => existing !== animation);
          });
      });
    }

    gridFlipAnimationsRef.current = animations;
  }, [favoriteItems, gridColumns, isLoading, isLoadingFavorites, isLoadingMore, mode, results]);

  const zoomGridIn = useCallback(() => {
    const index = GRID_COLUMN_OPTIONS.indexOf(gridColumnsRef.current);
    if (index <= 0) return;
    updateGridColumns(GRID_COLUMN_OPTIONS[index - 1]);
  }, [updateGridColumns]);

  const zoomGridOut = useCallback(() => {
    const index = GRID_COLUMN_OPTIONS.indexOf(gridColumnsRef.current);
    if (index >= GRID_COLUMN_OPTIONS.length - 1) return;
    updateGridColumns(GRID_COLUMN_OPTIONS[index + 1]);
  }, [updateGridColumns]);

  const handleGridPointerDownCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;

    activeTouchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activeTouchPointersRef.current.size < 2) return;

    const [first, second] = Array.from(activeTouchPointersRef.current.values());
    const startDistance = pointerDistance(first, second);
    if (startDistance <= 0) return;

    cancelLongPress();
    suppressTileSelectionBriefly();
    pinchGestureRef.current = {
      startColumns: gridColumnsRef.current,
      startDistance,
      midpoint: pointerMidpoint(first, second),
    };
  }, [cancelLongPress, suppressTileSelectionBriefly]);

  const handleGridPointerMoveCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" || !activeTouchPointersRef.current.has(event.pointerId)) return;

    activeTouchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchGestureRef.current;
    if (!pinch || activeTouchPointersRef.current.size < 2) return;

    const [first, second] = Array.from(activeTouchPointersRef.current.values());
    const distance = pointerDistance(first, second);
    if (distance <= 0) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    pinch.midpoint = pointerMidpoint(first, second);
    suppressTileSelectionBriefly();

    const ratio = distance / pinch.startDistance;
    const nextColumns = nearestGridColumns(pinch.startColumns / ratio);
    updateGridColumns(nextColumns);
  }, [suppressTileSelectionBriefly, updateGridColumns]);

  const endGridPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;

    activeTouchPointersRef.current.delete(event.pointerId);
    if (activeTouchPointersRef.current.size < 2 && pinchGestureRef.current) {
      pinchGestureRef.current = null;
      suppressTileSelectionBriefly();
    }
  }, [suppressTileSelectionBriefly]);

  const gridGestureHandlers = useMemo(() => ({
    onPointerDownCapture: handleGridPointerDownCapture,
    onPointerMoveCapture: handleGridPointerMoveCapture,
    onPointerUpCapture: endGridPointer,
    onPointerCancelCapture: endGridPointer,
  }), [endGridPointer, handleGridPointerDownCapture, handleGridPointerMoveCapture]);

  const runSearch = useCallback(async (
    rawQuery: string,
    count = SEARCH_BATCH_SIZE,
    options: { remember?: boolean; fromAuto?: boolean } = {},
  ) => {
    const q = rawQuery.trim();
    const shouldRemember = options.remember ?? true;
    const fromAuto = options.fromAuto === true;

    if (!q) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setIsLoading(false);
      setSubmittedQuery("");
      setResults([]);
      dispatch({ type: "SEARCH_CLEAR" });
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

    setShowHistory(false);
    setSubmittedQuery(q);
    if (fromAuto) {
      dispatch({ type: "AUTOSEARCH_COMMIT" });
    } else {
      dispatch({ type: "SEARCH_COMMIT" });
      scrollContainerRef.current?.scrollTo({ top: 0 });
      topBarInputRef.current?.blur();
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
      } else if (semanticResponse.status === "rejected" && textResponse.status === "rejected") {
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
    setDetailItem(null);
    dispatch({ type: "SIMILAR_SEARCH" });
    scrollContainerRef.current?.scrollTo({ top: 0 });
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
    if (isItemBlurred(item)) {
      setNsfwPendingItem(item);
      return;
    }
    if (modeRef.current === "detail") return;
    dispatch({ type: "DETAIL_OPEN" });
    setDetailItem(item);
    onSelectCandidate?.(item.id);
  }, [isItemBlurred, onSelectCandidate]);

  const closeDetail = useCallback(() => {
    dispatch({ type: "DETAIL_CLOSE" });
    setDetailItem(null);
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
      setDetailItem(null);
      dispatch({ type: "SEARCH_COMMIT" });
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

  const handleToggleFavorite = useCallback(async (item: RecallMediaItem) => {
    const current = item.metadata.organization?.favorite ?? false;
    const patch = { organization: { favorite: !current } };
    try {
      const updated = await patchCatalogItem(item.id, patch);
      if (detailItem?.id === item.id) {
        setDetailItem(updated);
      }
      const existsInFavorites = favoriteItems.some((f) => f.id === item.id);
      if (existsInFavorites && current) {
        setFavoriteItems((prev) => prev.filter((f) => f.id !== item.id));
      } else if (!existsInFavorites && !current) {
        setFavoriteItems((prev) => [updated, ...prev]);
      } else {
        setFavoriteItems((prev) =>
          prev.map((f) => (f.id === item.id ? updated : f)),
        );
      }
    } catch {
      // no-op
    }
  }, [detailItem, favoriteItems]);

  const handleToggleSafety = useCallback(async (item: RecallMediaItem, state: "safe" | "nsfw") => {
    const patch = { safety: { state } };
    try {
      const updated = await patchCatalogItem(item.id, patch);
      if (detailItem?.id === item.id) {
        setDetailItem(updated);
      }
      if (state === "safe") {
        setNsfwRevealedIds((prev) => new Set([...prev, item.id]));
        setNsfwPendingItem(null);
      }
    } catch {
      // no-op
    }
  }, [detailItem]);

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

  const enterComposeMode = useCallback((options: { showHistory?: boolean } = {}) => {
    if (modeRef.current !== "compose") {
      dispatch({ type: "SEARCH_FOCUS", startQuery: query });
    }
    if (typeof options.showHistory === "boolean") {
      setShowHistory(options.showHistory);
    }
  }, [query]);

  const closeComposeMode = useCallback(() => {
    setQuery(modeState.composeStartQuery);
    setShowHistory(false);
    setHistory(readSearchHistory());
    dispatch({ type: "COMPOSE_DISMISS" });
    topBarInputRef.current?.blur();
  }, [modeState.composeStartQuery]);

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

  // SR-1: dismiss compose on downward scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const st = el.scrollTop;
      const prev = prevScrollTopRef.current;

      if (st > prev && modeRef.current === "compose") {
        dispatch({ type: "COMPOSE_DISMISS" });
        topBarInputRef.current?.blur();
      }

      prevScrollTopRef.current = st;
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const currentMode = modeRef.current;
      if (currentMode !== "home" && currentMode !== "results") return;

      e.preventDefault();

      const normalized = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;
      wheelAccumRef.current += normalized;

      if (wheelAccumRef.current > 60) {
        wheelAccumRef.current = 0;
        zoomGridOut();
      } else if (wheelAccumRef.current < -60) {
        wheelAccumRef.current = 0;
        zoomGridIn();
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [zoomGridIn, zoomGridOut]);

  const handleItemPointerDown = useCallback((e: React.PointerEvent, item: RecallMediaItem) => {
    e.stopPropagation();
    if (isTileSelectionSuppressed()) {
      cancelLongPress();
      return;
    }
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    if (!isItemBlurred(item)) {
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        longPressTimerRef.current = null;
        openDetail(item);
      }, 500);
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, openDetail]);

  const handleItemPointerUp = useCallback((_e: React.PointerEvent, item: RecallMediaItem) => {
    cancelLongPress();
    if (isTileSelectionSuppressed()) return;
    if (!longPressTriggeredRef.current) {
      if (isItemBlurred(item)) {
        setNsfwPendingItem(item);
      } else {
        toggleSelected(item);
      }
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, toggleSelected]);

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
    cancelLongPress();
  }, [cancelLongPress]);

  const refinements = useMemo(
    () => suggestions.filter((s) => s.toLowerCase() !== submittedQuery.toLowerCase()).slice(0, 4),
    [suggestions, submittedQuery],
  );
  const visibleHistory = history.length > 0 ? history : readSearchHistory();
  const activeHistory = showHistory ? readSearchHistory() : visibleHistory;
  const composeQuery = query.trim();
  const composeSuggestions = composeQuery ? suggestions.slice(0, 3) : [];
  const usesNaturalAspectGrid = gridColumns === 1;
  const mediaGridClassName = `grid phone-media-grid${usesNaturalAspectGrid ? " phone-media-grid--natural" : ""}`;
  const hasMore = results.length >= visibleCount && contentMode === "results";
  const showSelectionTray = selectedItems.length > 0 && mode !== "detail" && mode !== "compose";
  const showFavoritesSection = isLoadingFavorites || favoriteItems.length > 0;
  liveRef.current = { hasMore, submittedQuery, query, visibleCount, prefetchedResults };

  const handleAssistSearch = useCallback((nextQuery: string) => {
    setShowHistory(false);
    setQuery(nextQuery);
    void runSearch(nextQuery);
  }, [runSearch]);

  const handleSearchHistoryToggle = useCallback(() => {
    if (modeRef.current !== "compose") {
      enterComposeMode({ showHistory: true });
      return;
    }
    setShowHistory((prev) => !prev);
  }, [enterComposeMode]);

  const handleSearchFocus = useCallback(() => {
    enterComposeMode();
  }, [enterComposeMode]);

  const cancelAutoSearch = useCallback(() => {
    if (autoSearchTimerRef.current !== null) {
      window.clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
    setIsAutoSearchPending(false);
  }, []);

  const handleSearchChange = useCallback((nextQuery: string) => {
    if (nextQuery === "" && bgContentRef.current === "results") {
      cancelAutoSearch();
      abortActiveSearch();
      setQuery("");
      setSubmittedQuery("");
      setShowHistory(false);
      setHistory(readSearchHistory());
      dispatch({ type: "SEARCH_CLEAR" });
      topBarInputRef.current?.blur();
      return;
    }
    setQuery(nextQuery);
    setShowHistory(false);
    if (modeRef.current !== "compose") {
      enterComposeMode();
    }
  }, [abortActiveSearch, cancelAutoSearch, enterComposeMode]);

  const handleSearchSubmit = useCallback(() => {
    cancelAutoSearch();
    void runSearch(query);
  }, [cancelAutoSearch, query, runSearch]);

  const handleSearchClear = useCallback(() => {
    cancelAutoSearch();
    abortActiveSearch();
    if (modeRef.current === "compose" && bgContentRef.current !== "results") {
      setQuery("");
      setShowHistory(true);
      return;
    }
    setQuery("");
    setSubmittedQuery("");
    setShowHistory(false);
    setHistory(readSearchHistory());
    dispatch({ type: "SEARCH_CLEAR" });
    topBarInputRef.current?.blur();
  }, [abortActiveSearch, cancelAutoSearch]);

  useEffect(() => {
    if (autoSearchTimerRef.current !== null) {
      clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
    const q = query.trim();
    if (modeRef.current !== "compose" || q.length < 2) {
      setIsAutoSearchPending(false);
      return;
    }
    setIsAutoSearchPending(true);
    autoSearchTimerRef.current = setTimeout(() => {
      autoSearchTimerRef.current = null;
      setIsAutoSearchPending(false);
      void runSearch(q, SEARCH_BATCH_SIZE, { remember: false, fromAuto: true });
    }, 400);
    return () => {
      if (autoSearchTimerRef.current !== null) {
        clearTimeout(autoSearchTimerRef.current);
        autoSearchTimerRef.current = null;
      }
      setIsAutoSearchPending(false);
    };
  }, [query, runSearch]);

  const isSearching = isAutoSearchPending || (isLoading && mode === "compose");

  const renderSearchBar = (className?: string, clearLabel = "Clear search") => (
    <PhoneSearchBar
      ref={topBarInputRef}
      value={query}
      className={className}
      clearLabel={clearLabel}
      showHistory={showHistory}
      isSearching={isSearching}
      onToggleHistory={handleSearchHistoryToggle}
      onFocus={handleSearchFocus}
      onChange={handleSearchChange}
      onSubmit={handleSearchSubmit}
      onClear={handleSearchClear}
    />
  );

  return (
    <div
      ref={phoneRectRef}
      className={`phone-rect${contentMode === "home" ? " phone-rect--home" : ""}${showSelectionTray ? " phone-rect--has-selection" : ""}`}
      style={gridDensityStyle}
      data-reduced-motion={prefersReducedMotion ? "true" : undefined}
      aria-label="Phone interface viewport"
      onKeyDown={(event) => {
        if (event.key === "Escape" && modeRef.current === "compose") {
          closeComposeMode();
          return;
        }
        if (event.key === "Escape" && mode !== "home") {
          abortActiveSearch();
          setQuery("");
          setSubmittedQuery("");
          setShowHistory(false);
          setHistory(readSearchHistory());
          dispatch({ type: "SEARCH_CLEAR" });
          topBarInputRef.current?.blur();
        }
      }}
    >
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

        <MotionConfig reducedMotion="user">
        <LayoutGroup id="phone-ui">

        {/* Persistent section — bar + accordion suggestions in normal flow */}
        {mode !== "home" && !(mode === "compose" && contentMode === "home") ? (
          <div className="phone-persistent-section phone-persistent-search">
            <div className={`search-panel${mode === "compose" ? " search-panel--expanded" : ""}`}>
              {renderSearchBar()}
              <AnimatePresence initial={false}>
                {mode === "compose" ? (
                  <motion.div
                    key="compose-results-inline"
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="phone-compose-section">
                      <SearchAssistPanel
                        query={query}
                        showHistory={showHistory}
                        history={activeHistory}
                        suggestions={composeSuggestions}
                        knownHistory={visibleHistory}
                        isSearching={isSearching}
                        onRunSearch={handleAssistSearch}
                        onClearHistory={clearHistory}
                        onRemoveHistoryItem={removeHistoryItem}
                      />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        ) : null}

        {/* Main scrollable content */}
        <ScrollArea
          className="phone-rect-content"
          viewportRef={scrollContainerRef}
          viewportClassName="phone-rect-viewport"
          onPointerDownCapture={mode === "compose" && contentMode !== "home" ? () => dispatch({ type: "COMPOSE_DISMISS" }) : undefined}
        >
          <>
            {contentMode === "home" ? (
              <motion.div
                key="screen-home"
                className="phone-screen phone-screen--home"
                custom={modeTransition}
                variants={screenMotionVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                <div className="phone-startpage">
              <PhoneHomeHeader mode={mode} onExit={onExit} />

              <div className="phone-startpage-search-sticky">
                <div className={`search-panel${mode === "compose" ? " search-panel--expanded" : ""}`}>
                  {renderSearchBar(undefined, "Clear draft search")}
                  <AnimatePresence initial={false}>
                    {mode === "compose" ? (
                      <motion.div
                        key="compose-home-inline"
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                        style={{ overflow: "hidden" }}
                      >
                        <div className="phone-compose-section">
                          <SearchAssistPanel
                            query={query}
                            showHistory={showHistory}
                            history={activeHistory}
                            suggestions={composeSuggestions}
                            knownHistory={visibleHistory}
                            isSearching={isSearching}
                            onRunSearch={handleAssistSearch}
                            onClearHistory={clearHistory}
                            onRemoveHistoryItem={removeHistoryItem}
                          />
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>

	              {showFavoritesSection ? (
                <FavoritesSection
                  favoriteItems={favoriteItems}
                  favoritesGridRef={favoritesGridRef}
                  gridClassName={mediaGridClassName}
                  gridGestureHandlers={gridGestureHandlers}
                  gridColumns={gridColumns}
                  isLoadingFavorites={isLoadingFavorites}
                  naturalAspectRatio={usesNaturalAspectGrid}
                  selectedItems={selectedItems}
                  isItemBlurred={isItemBlurred}
                  onZoomIn={zoomGridIn}
                  onZoomOut={zoomGridOut}
                  onItemPointerDown={handleItemPointerDown}
                  onItemPointerUp={handleItemPointerUp}
                  onItemPointerMove={handleItemPointerMove}
                  onItemPointerCancel={handleItemPointerCancel}
                  toggleSelected={toggleSelected}
                />
              ) : null}

                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="screen-search"
                    className={`phone-screen phone-screen--search${mode === "compose" ? " phone-screen--dimmed" : ""}${isLoading && mode === "results" && contentMode === "results" ? " phone-screen--loading" : ""}`}
                    custom={modeTransition}
                    variants={screenMotionVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                  >
                    <ResultsSection
                      results={results}
                      searchGridRef={searchGridRef}
                      gridClassName={mediaGridClassName}
                      gridGestureHandlers={gridGestureHandlers}
                      gridColumns={gridColumns}
                      isLoading={isLoading}
                      isLoadingMore={isLoadingMore}
                      contentMode={contentMode}
                      submittedQuery={submittedQuery}
                      errorMessage={errorMessage}
                      hasMore={hasMore}
                      refinements={refinements}
                      naturalAspectRatio={usesNaturalAspectGrid}
                      selectedItems={selectedItems}
                      isItemBlurred={isItemBlurred}
                      onZoomIn={zoomGridIn}
                      onZoomOut={zoomGridOut}
                      onItemPointerDown={handleItemPointerDown}
                      onItemPointerUp={handleItemPointerUp}
                      onItemPointerMove={handleItemPointerMove}
                      onItemPointerCancel={handleItemPointerCancel}
                      toggleSelected={toggleSelected}
                      onLoadMore={() => void loadMore()}
                      onRunRefinement={(refinement) => {
                        setQuery(refinement);
                        void runSearch(refinement);
                      }}
                    />
                  </motion.div>
                )}
          </>
        </ScrollArea>

        {/* Detail view — outside ScrollArea so it covers the persistent search bar */}
        <AnimatePresence initial={false}>
          {mode === "detail" && detailItem && (
            isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
              <VideoDetailView
                key={detailItem.id}
                item={detailItem}
                onBack={closeDetail}
                onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)}
                onConfirmAnswer={onConfirmAnswer}
                onSendSelection={sendSelection}
                onToggleFavorite={handleToggleFavorite}
                onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem}
                layoutId={mediaLayoutId(detailItem.id)}
              />
            ) : (
              <ImageDetailView
                key={detailItem.id}
                item={detailItem}
                onBack={closeDetail}
                onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)}
                onConfirmAnswer={onConfirmAnswer}
                onSendSelection={sendSelection}
                onToggleFavorite={handleToggleFavorite}
                onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem}
                layoutId={mediaLayoutId(detailItem.id)}
              />
            )
          )}
        </AnimatePresence>

        </LayoutGroup>
        </MotionConfig>


        {/* NSFW reveal dialog */}
        {nsfwPendingItem && (
          <NsfwDialog
            item={nsfwPendingItem}
            onKeepHidden={() => setNsfwPendingItem(null)}
            onRevealOne={(id) => { setNsfwRevealedIds((prev) => new Set([...prev, id])); setNsfwPendingItem(null); }}
            onRevealAll={() => { setNsfwRevealedAll(true); setNsfwPendingItem(null); }}
            onMarkSafe={(item) => void handleToggleSafety(item, "safe")}
          />
        )}

        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false}>
            {aboutSheetItem && (
              <AboutSheet item={aboutSheetItem} onClose={() => setAboutSheetItem(null)} />
            )}
          </AnimatePresence>
        </MotionConfig>

        {/* Selection tray — floats above the scroll area */}
        <MotionConfig reducedMotion="user">
          {showSelectionTray && (
            <SelectionTray
              selectedItems={selectedItems}
              toggleSelected={toggleSelected}
              onConfirmAnswer={onConfirmAnswer}
              onClearSelection={() => setSelectedItems([])}
            />
          )}
        </MotionConfig>
    </div>
  );
}
