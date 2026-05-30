import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isVideo, resolvedMediaUrl } from "@/shared/media/mediaItem";
import {
  SEARCH_BATCH_SIZE, FAVORITES_COUNT, OVERSCROLL_THRESHOLD,
  makeMockItem, readSearchHistory, writeSearchHistory,
  rememberSearch, mergeResults, localSuggestions, mediaLayoutId,
} from "./phoneUtils";
import { AboutSheet } from "./AboutSheet";
import { NsfwDialog } from "./NsfwDialog";
import { ImageDetailView } from "./ImageDetailView";
import { SelectionTray } from "./SelectionTray";
import { VideoDetailView } from "./VideoDetailView";
import {
  listFavoriteItems, listRecentItems,
  searchSemantic, searchSimilarById, searchText, suggestSearches,
} from "../api/searchApi";
import {
  initialPhoneModeState, phoneModeReducer,
  type PhoneScreen,
} from "../phoneReducer";
import { PhoneSearchBar } from "./SearchCommandLayer";
import { useGridDensity } from "./useGridDensity";
import { useNsfwReveal } from "./useNsfwReveal";
import { usePhoneDetail } from "./usePhoneDetail";
import { useSelectionTray } from "./useSelectionTray";
import { PhoneSearchShell } from "./PhoneSearchShell";
import { PhoneHomeHeader } from "./PhoneHomeHeader";
import { HomeLayer } from "./HomeLayer";
import { ResultsLayer } from "./ResultsLayer";

interface PhoneViewportFrameProps {
  currentTarget?: RecallMediaItem;
  onSelectCandidate?: (id: string) => void;
  onConfirmAnswer?: (id: string) => void;
  onExit?: () => void;
}
type PhoneMode = PhoneScreen;

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
  const [favoriteItems, setFavoriteItems] = useState<RecallMediaItem[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);
  const [overscrollProgress, setOverscrollProgress] = useState(0);
  const [prefetchedResults, setPrefetchedResults] = useState<RecallMediaItem[] | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const phoneRectRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<PhoneMode>("home");
  const bgContentRef = useRef(contentMode);
  bgContentRef.current = contentMode;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchGridRef = useRef<HTMLDivElement>(null);
  const favoritesGridRef = useRef<HTMLDivElement>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const hasPrefetchedRef = useRef(false);
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const liveRef = useRef({ hasMore: false, submittedQuery: "", query: "", visibleCount: SEARCH_BATCH_SIZE, prefetchedResults: null as RecallMediaItem[] | null });
  const prevScrollTopRef = useRef(0);
  const [isAutoSearchPending, setIsAutoSearchPending] = useState(false);
  const [showComposePanel, setShowComposePanel] = useState(true);
  const [isAtScrollTop, setIsAtScrollTop] = useState(true);

  const HIDE_COMPOSE_THRESHOLD = 60;

  const { isItemBlurred, nsfwPendingItem, setNsfwPendingItem, revealOne, revealAll, revealSafe } = useNsfwReveal();

  const { toggleSelected } = useSelectionTray(selectedItems, setSelectedItems);

  const runSearch = useCallback(async (rawQuery: string, count = SEARCH_BATCH_SIZE, options: { remember?: boolean; fromAuto?: boolean } = {}) => {
    const q = rawQuery.trim();
    const shouldRemember = options.remember ?? true;
    const fromAuto = options.fromAuto === true;
    if (!q) { searchAbortRef.current?.abort(); searchAbortRef.current = null; setIsLoading(false); setSubmittedQuery(""); setResults([]); dispatch({ type: "SEARCH_CLEAR" }); return; }
    searchAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort(); loadMoreAbortRef.current = null; setIsLoadingMore(false);
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsLoading(true); setErrorMessage(null); setResults([]); setVisibleCount(count);
    setShowHistory(false); setSubmittedQuery(q);
    if (fromAuto) dispatch({ type: "AUTOSEARCH_COMMIT" });
    else { dispatch({ type: "SEARCH_COMMIT" }); scrollContainerRef.current?.scrollTo({ top: 0 }); topBarInputRef.current?.blur(); }
    try {
      const [sr, tr] = await Promise.allSettled([searchSemantic(q, count, { signal: controller.signal }), searchText(q, Math.min(count, 30), { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const nextResults = mergeResults(sr.status === "fulfilled" ? sr.value.results : [], tr.status === "fulfilled" ? tr.value.results : []).slice(0, count);
      if (nextResults.length > 0) setResults(nextResults);
      else if (sr.status === "rejected" && tr.status === "rejected") { setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, i) => makeMockItem(`${q}-${i}`, q))); setErrorMessage("Backend unavailable. Showing sample tiles until the media bundle is indexed."); }
      else setResults([]);
      if (shouldRemember) { rememberSearch(q); setHistory(readSearchHistory()); }
    } finally { if (!controller.signal.aborted && searchAbortRef.current === controller) setIsLoading(false); }
  }, [dispatch]);

  const { detailItem, setDetailItem, openDetail, closeDetail, handleToggleFavorite, handleToggleSafety, searchSameDate } = usePhoneDetail({
    isItemBlurred, onSelectCandidate, modeRef, dispatch, favoriteItems, setFavoriteItems,
    setQuery, runSearch, setErrorMessage, setNsfwPendingItem, revealSafe,
  });

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSelectionUntilRef = useRef(0);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    pointerDownPosRef.current = null;
  }, []);

  const suppressTileSelectionBriefly = useCallback(() => {
    suppressSelectionUntilRef.current = (typeof window !== "undefined" ? window.performance.now() : Date.now()) + 450;
  }, []);

  const isTileSelectionSuppressed = useCallback(() => {
    return (typeof window !== "undefined" ? window.performance.now() : Date.now()) < suppressSelectionUntilRef.current;
  }, []);

  const { gridColumns, gridDensityStyle, zoomGridIn, zoomGridOut, pinchHandlers, wheelHandler } = useGridDensity(
    favoritesGridRef, searchGridRef, favoriteItems, results, isLoading, isLoadingFavorites, isLoadingMore, mode,
    cancelLongPress, suppressTileSelectionBriefly,
  );

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
      if (longPressTimerRef.current !== null) clearTimeout(longPressTimerRef.current);
      if (autoSearchTimerRef.current !== null) clearTimeout(autoSearchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setDetailItem(null);
    setSelectedItems([]);
    if (modeRef.current === "detail") dispatch({ type: "TARGET_RESET" });
  }, [currentTarget?.id, dispatch, setDetailItem]);

  useEffect(() => {
    const controller = new AbortController();
    listRecentItems(SEARCH_BATCH_SIZE, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted && response.results.length > 0) setResults(response.results); })
      .catch(() => { if (!controller.signal.aborted) setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, i) => makeMockItem(`recent-${i}`))); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingFavorites(true);
    listFavoriteItems(FAVORITES_COUNT, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setFavoriteItems(response.results); })
      .catch(() => { if (!controller.signal.aborted) setFavoriteItems([]); })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingFavorites(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setSuggestions(history.slice(0, 5)); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggestSearches(q, 6, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          const next = [...response.suggestions, ...localSuggestions(q, history)];
          setSuggestions(next.filter((item, idx, all) => all.findIndex((c) => c.toLowerCase() === item.toLowerCase()) === idx).slice(0, 6));
        })
        .catch(() => { if (!controller.signal.aborted) setSuggestions(localSuggestions(q, history)); });
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [history, query]);

  useEffect(() => { if (mode === "compose") topBarInputRef.current?.focus(); modeRef.current = mode; }, [contentMode, mode]);

  useEffect(() => {
    if (modeTransition.reason === "search-clear") scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [modeTransition]);

  // Reset header visibility when returning to home
  useEffect(() => {
    if (contentMode === "home") setIsAtScrollTop(true);
  }, [contentMode]);

  useEffect(() => {
    const el = phoneRectRef.current;
    if (!el) return;
    return wheelHandler(el);
  }, [wheelHandler]);

  // SR-4: home header hides on scroll, reappears at scroll top
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => { setIsAtScrollTop(el.scrollTop <= 4); };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // SR-1: dismiss compose on downward scroll (home) or collapse panel (results)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (modeRef.current !== "compose") return;
      const st = el.scrollTop;
      if (bgContentRef.current === "results") {
        if (st > HIDE_COMPOSE_THRESHOLD) setShowComposePanel(false);
        else if (st <= 0) setShowComposePanel(true);
      } else {
        if (st > prevScrollTopRef.current) { dispatch({ type: "COMPOSE_DISMISS" }); topBarInputRef.current?.blur(); }
      }
      prevScrollTopRef.current = st;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode, dispatch]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "results") return;
    const handleScroll = () => { if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) void prefetchNextBatch(); };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "results") return;
    let hitBottomAtY: number | null = null, touchStartY = 0, currentOverscroll = 0;
    const isAtBottom = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    const onTouchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY; hitBottomAtY = null; currentOverscroll = 0; };
    const onTouchMove = (e: TouchEvent) => {
      const touchY = e.touches[0].clientY;
      if (isAtBottom()) {
        if (hitBottomAtY === null && touchStartY > touchY) hitBottomAtY = touchY;
        if (hitBottomAtY !== null) {
          const delta = Math.max(0, hitBottomAtY - touchY);
          currentOverscroll = delta;
          if (delta > 0) { e.preventDefault(); setOverscrollProgress(Math.min(1, delta / OVERSCROLL_THRESHOLD)); }
        }
      } else if (currentOverscroll > 0) { currentOverscroll = 0; hitBottomAtY = null; setOverscrollProgress(0); }
    };
    const onTouchEnd = () => {
      const delta = currentOverscroll; currentOverscroll = 0; setOverscrollProgress(0);
      if (delta >= OVERSCROLL_THRESHOLD && liveRef.current.hasMore) {
        const { prefetchedResults: cached, visibleCount: vc } = liveRef.current;
        if (cached) { setResults(cached); setVisibleCount(vc + SEARCH_BATCH_SIZE); setErrorMessage(null); setPrefetchedResults(null); hasPrefetchedRef.current = false; }
        else { void loadMore(); }
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => { el.removeEventListener("touchstart", onTouchStart); el.removeEventListener("touchmove", onTouchMove); el.removeEventListener("touchend", onTouchEnd); el.removeEventListener("touchcancel", onTouchEnd); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const runSimilarSearch = useCallback(async (item: RecallMediaItem) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsLoading(true); setErrorMessage(null); setResults([]); setDetailItem(null);
    dispatch({ type: "SIMILAR_SEARCH" }); scrollContainerRef.current?.scrollTo({ top: 0 }); setSubmittedQuery("similar items"); setQuery("");
    try {
      const response = await searchSimilarById(item.id, SEARCH_BATCH_SIZE, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(response.results);
    } catch { if (!controller.signal.aborted) { setErrorMessage("Similar search is available after this item has an indexed embedding."); setResults([]); } }
    finally { if (!controller.signal.aborted && searchAbortRef.current === controller) setIsLoading(false); }
  }, [dispatch]);

  const sendSelection = useCallback((item?: RecallMediaItem) => {
    const next = item && !selectedItems.some((c) => c.id === item.id) ? [...selectedItems, item] : selectedItems;
    setSelectedItems(next);
  }, [selectedItems]);

  const removeHistoryItem = useCallback((item: string) => {
    setHistory((prev) => { const next = prev.filter((h) => h.toLowerCase() !== item.toLowerCase()); writeSearchHistory(next); return next; });
  }, []);

  const clearHistory = useCallback(() => { setHistory([]); writeSearchHistory([]); }, []);

  const abortActiveSearch = useCallback(() => { searchAbortRef.current?.abort(); searchAbortRef.current = null; setIsLoading(false); }, []);

  const enterComposeMode = useCallback((opts: { showHistory?: boolean } = {}) => {
    if (modeRef.current !== "compose") dispatch({ type: "SEARCH_FOCUS", startQuery: query });
    if (typeof opts.showHistory === "boolean") setShowHistory(opts.showHistory);
  }, [query, dispatch]);

  const closeComposeMode = useCallback(() => {
    setQuery(modeState.composeStartQuery); setShowHistory(false); setHistory(readSearchHistory()); dispatch({ type: "COMPOSE_DISMISS" }); topBarInputRef.current?.blur();
  }, [modeState.composeStartQuery, dispatch]);

  const prefetchNextBatch = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, visibleCount: vc } = liveRef.current;
    if (!live || hasPrefetchedRef.current || !sq) return;
    hasPrefetchedRef.current = true;
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [sr, tr] = await Promise.allSettled([searchSemantic(sq, nextCount, { signal: controller.signal }), searchText(sq, Math.min(nextCount, 30), { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const nextResults = mergeResults(sr.status === "fulfilled" ? sr.value.results : [], tr.status === "fulfilled" ? tr.value.results : []).slice(0, nextCount);
      if (nextResults.length > 0) setPrefetchedResults(nextResults);
    } catch { if (!controller.signal.aborted) hasPrefetchedRef.current = false; }
  }, []);

  const loadMore = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, query: q, visibleCount: vc, prefetchedResults: cached } = liveRef.current;
    if (!live) return;
    if (cached) { setResults(cached); setVisibleCount(vc + SEARCH_BATCH_SIZE); setErrorMessage(null); setPrefetchedResults(null); hasPrefetchedRef.current = false; return; }
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setIsLoadingMore(true);
    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [sr, tr] = await Promise.allSettled([searchSemantic(sq || q, nextCount, { signal: controller.signal }), searchText(sq || q, Math.min(nextCount, 30), { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const nextResults = mergeResults(sr.status === "fulfilled" ? sr.value.results : [], tr.status === "fulfilled" ? tr.value.results : []).slice(0, nextCount);
      if (nextResults.length > 0) { setResults(nextResults); setVisibleCount(nextCount); }
    } finally { if (!controller.signal.aborted) setIsLoadingMore(false); }
  }, []);

  useEffect(() => {
    hasPrefetchedRef.current = false; setPrefetchedResults(null); prefetchAbortRef.current?.abort(); prefetchAbortRef.current = null;
  }, [submittedQuery]);

  const handleItemPointerDown = useCallback((e: React.PointerEvent, item: RecallMediaItem) => {
    e.stopPropagation();
    if (isTileSelectionSuppressed()) { cancelLongPress(); return; }
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    if (!isItemBlurred(item)) {
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true; longPressTimerRef.current = null; openDetail(item);
      }, 500);
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, openDetail]);

  const handleItemPointerUp = useCallback((_e: React.PointerEvent, item: RecallMediaItem) => {
    cancelLongPress();
    if (isTileSelectionSuppressed()) return;
    if (!longPressTriggeredRef.current) {
      if (isItemBlurred(item)) setNsfwPendingItem(item);
      else toggleSelected(item);
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, toggleSelected, setNsfwPendingItem]);

  const handleItemPointerMove = useCallback((e: React.PointerEvent) => {
    if (longPressTimerRef.current !== null && pointerDownPosRef.current) {
      const dx = e.clientX - pointerDownPosRef.current.x, dy = e.clientY - pointerDownPosRef.current.y;
      if (dx * dx + dy * dy > 64) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    }
  }, []);

  const handleItemPointerCancel = useCallback(() => { cancelLongPress(); }, [cancelLongPress]);

  const refinements = useMemo(() => suggestions.filter((s) => s.toLowerCase() !== submittedQuery.toLowerCase()).slice(0, 4), [suggestions, submittedQuery]);
  const visibleHistory = history.length > 0 ? history : readSearchHistory();
  const activeHistory = showHistory ? readSearchHistory() : visibleHistory;
  const composeQuery = query.trim();
  const composeSuggestions = composeQuery ? suggestions.slice(0, 3) : [];
  const usesNaturalAspectGrid = gridColumns === 1;
  const mediaGridClassName = `grid phone-media-grid${usesNaturalAspectGrid ? " phone-media-grid--natural" : ""}`;
  const hasMore = results.length >= visibleCount && contentMode === "results";
  const showSelectionTray = selectedItems.length > 0 && mode !== "detail" && mode !== "compose";
  liveRef.current = { hasMore, submittedQuery, query, visibleCount, prefetchedResults };

  const handleAssistSearch = useCallback((nextQuery: string) => { setShowHistory(false); setQuery(nextQuery); void runSearch(nextQuery); }, [runSearch]);
  const handleSearchHistoryToggle = useCallback(() => { if (modeRef.current !== "compose") { enterComposeMode({ showHistory: true }); return; } setShowHistory((p) => !p); }, [enterComposeMode]);
  const handleSearchFocus = useCallback(() => { enterComposeMode(); }, [enterComposeMode]);
  const cancelAutoSearch = useCallback(() => { if (autoSearchTimerRef.current !== null) { window.clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; } setIsAutoSearchPending(false); }, []);

  const handleSearchChange = useCallback((nextQuery: string) => {
    if (nextQuery === "" && bgContentRef.current === "results") {
      cancelAutoSearch(); abortActiveSearch(); setQuery(""); setSubmittedQuery(""); setShowHistory(false); setHistory(readSearchHistory());
      dispatch({ type: "SEARCH_CLEAR" }); topBarInputRef.current?.blur(); return;
    }
    setQuery(nextQuery); setShowHistory(false);
    if (nextQuery) setShowComposePanel(true);
    if (modeRef.current !== "compose") enterComposeMode();
  }, [abortActiveSearch, cancelAutoSearch, enterComposeMode, dispatch]);

  const handleSearchSubmit = useCallback(() => { cancelAutoSearch(); void runSearch(query); }, [cancelAutoSearch, query, runSearch]);

  const handleSearchClear = useCallback(() => {
    cancelAutoSearch(); abortActiveSearch();
    if (modeRef.current === "compose" && bgContentRef.current !== "results") { setQuery(""); setShowHistory(true); return; }
    setQuery(""); setSubmittedQuery(""); setShowHistory(false); setHistory(readSearchHistory());
    dispatch({ type: "SEARCH_CLEAR" }); topBarInputRef.current?.blur();
  }, [abortActiveSearch, cancelAutoSearch, dispatch]);

  useEffect(() => {
    if (autoSearchTimerRef.current !== null) { clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; }
    const q = query.trim();
    if (modeRef.current !== "compose" || q.length < 2) { setIsAutoSearchPending(false); return; }
    setIsAutoSearchPending(true);
    autoSearchTimerRef.current = setTimeout(() => {
      autoSearchTimerRef.current = null; setIsAutoSearchPending(false);
      void runSearch(q, SEARCH_BATCH_SIZE, { remember: false, fromAuto: true });
    }, 400);
    return () => { if (autoSearchTimerRef.current !== null) { clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; } setIsAutoSearchPending(false); };
  }, [query, runSearch]);

  const isSearching = isAutoSearchPending || (isLoading && mode === "compose");

  const renderSearchBar = (className?: string, clearLabel = "Clear search") => (
    <PhoneSearchBar ref={topBarInputRef} value={query} className={className} clearLabel={clearLabel}
      showHistory={showHistory} isSearching={isSearching}
      onToggleHistory={handleSearchHistoryToggle} onFocus={handleSearchFocus}
      onChange={handleSearchChange} onSubmit={handleSearchSubmit} onClear={handleSearchClear} />
  );

  return (
    <div ref={phoneRectRef}
      className={`phone-rect${contentMode === "home" ? " phone-rect--home" : ""}${showSelectionTray ? " phone-rect--has-selection" : ""}`}
      style={gridDensityStyle} data-reduced-motion={prefersReducedMotion ? "true" : undefined}
      aria-label="Phone interface viewport"
      onKeyDown={(event) => {
        if (event.key === "Escape" && modeRef.current === "compose") { closeComposeMode(); return; }
        if (event.key === "Escape" && mode !== "home") {
          abortActiveSearch(); setQuery(""); setSubmittedQuery(""); setShowHistory(false); setHistory(readSearchHistory());
          dispatch({ type: "SEARCH_CLEAR" }); topBarInputRef.current?.blur();
        }
      }}
    >
      {mode === "results" && hasMore ? (
        <div className={`pull-indicator${overscrollProgress > 0 ? " pull-indicator--visible" : ""}${overscrollProgress >= 1 ? " pull-indicator--ready" : ""}`} aria-hidden>
          <svg className="pull-indicator-ring" viewBox="0 0 20 20">
            <circle className="pull-indicator-track" cx="10" cy="10" r="8" />
            <circle className="pull-indicator-fill" cx="10" cy="10" r="8" style={{ strokeDashoffset: 50.3 * (1 - overscrollProgress) }} />
          </svg>
          <span>{overscrollProgress >= 1 ? "Release!" : "More results"}</span>
        </div>
      ) : null}

      <MotionConfig reducedMotion="user">
      <LayoutGroup id="phone-ui">

        <AnimatePresence initial={false}>
          {contentMode === "home" && isAtScrollTop && (
            <motion.div key="home-header"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              style={{ overflow: "hidden" }}>
              <PhoneHomeHeader onExit={onExit} />
            </motion.div>
          )}
        </AnimatePresence>

        <PhoneSearchShell
          mode={mode} query={query}
          showHistory={showHistory} activeHistory={activeHistory}
          composeSuggestions={composeSuggestions} visibleHistory={visibleHistory}
          isSearching={isSearching} showComposePanel={showComposePanel}
          onAssistSearch={handleAssistSearch} onClearHistory={clearHistory}
          onRemoveHistoryItem={removeHistoryItem} renderSearchBar={renderSearchBar}
        />

        <ScrollArea className="phone-rect-content" viewportRef={scrollContainerRef} viewportClassName="phone-rect-viewport"
          onPointerDownCapture={mode === "compose" && contentMode !== "home" ? () => dispatch({ type: "COMPOSE_DISMISS" }) : undefined}>
          <>
            <HomeLayer visible={contentMode === "home"} modeTransition={modeTransition}
              favoriteItems={favoriteItems} favoritesGridRef={favoritesGridRef} mediaGridClassName={mediaGridClassName}
              pinchHandlers={pinchHandlers} gridColumns={gridColumns} isLoadingFavorites={isLoadingFavorites}
              usesNaturalAspectGrid={usesNaturalAspectGrid} selectedItems={selectedItems} isItemBlurred={isItemBlurred}
              zoomGridIn={zoomGridIn} zoomGridOut={zoomGridOut}
              handleItemPointerDown={handleItemPointerDown} handleItemPointerUp={handleItemPointerUp}
              handleItemPointerMove={handleItemPointerMove} handleItemPointerCancel={handleItemPointerCancel}
              toggleSelected={toggleSelected} />
            <ResultsLayer visible={contentMode === "results"} mode={mode} contentMode={contentMode}
              isLoading={isLoading} isLoadingMore={isLoadingMore} modeTransition={modeTransition}
              results={results} searchGridRef={searchGridRef} mediaGridClassName={mediaGridClassName}
              pinchHandlers={pinchHandlers} gridColumns={gridColumns}
              submittedQuery={submittedQuery} errorMessage={errorMessage} hasMore={hasMore}
              refinements={refinements} usesNaturalAspectGrid={usesNaturalAspectGrid}
              selectedItems={selectedItems} isItemBlurred={isItemBlurred}
              zoomGridIn={zoomGridIn} zoomGridOut={zoomGridOut}
              handleItemPointerDown={handleItemPointerDown} handleItemPointerUp={handleItemPointerUp}
              handleItemPointerMove={handleItemPointerMove} handleItemPointerCancel={handleItemPointerCancel}
              toggleSelected={toggleSelected} loadMore={() => void loadMore()}
              onRunRefinement={(refinement) => { setQuery(refinement); void runSearch(refinement); }} />
          </>
        </ScrollArea>

        <AnimatePresence initial={false}>
          {mode === "detail" && detailItem && (
            isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
              <VideoDetailView key={detailItem.id} item={detailItem} onBack={closeDetail} onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)} onConfirmAnswer={onConfirmAnswer}
                onSendSelection={sendSelection} onToggleFavorite={handleToggleFavorite} onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem} layoutId={mediaLayoutId(detailItem.id)} />
            ) : (
              <ImageDetailView key={detailItem.id} item={detailItem} onBack={closeDetail} onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)} onConfirmAnswer={onConfirmAnswer}
                onSendSelection={sendSelection} onToggleFavorite={handleToggleFavorite} onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem} layoutId={mediaLayoutId(detailItem.id)} />
            )
          )}
        </AnimatePresence>

      </LayoutGroup>
      </MotionConfig>

      {nsfwPendingItem && (
        <NsfwDialog item={nsfwPendingItem} onKeepHidden={() => setNsfwPendingItem(null)}
          onRevealOne={revealOne} onRevealAll={revealAll}
          onMarkSafe={(item) => void handleToggleSafety(item, "safe")} />
      )}

      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>
          {aboutSheetItem && <AboutSheet item={aboutSheetItem} onClose={() => setAboutSheetItem(null)} />}
        </AnimatePresence>
      </MotionConfig>

      <MotionConfig reducedMotion="user">
        {showSelectionTray && (
          <SelectionTray selectedItems={selectedItems} toggleSelected={toggleSelected}
            onConfirmAnswer={onConfirmAnswer} onClearSelection={() => setSelectedItems([])} />
        )}
      </MotionConfig>
    </div>
  );
}