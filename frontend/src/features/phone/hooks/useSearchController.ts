import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RecallMediaItem } from "@/shared/types/recall";
import {
  SEARCH_BATCH_SIZE, makeMockItem, readSearchHistory, writeSearchHistory,
  rememberSearch, mergeResults, localSuggestions,
  AUTOSEARCH_DEBOUNCE_MS, SUGGESTION_DEBOUNCE_MS, PREFETCH_TRIGGER_REMAINING,
} from "../phoneUtils";
import {
  listItemsByDate, listRecentItems, searchSemantic, searchSimilarById, searchText, suggestSearches,
} from "../api/searchApi";
import type { PhoneModeAction, PhoneBgContent, PhoneModeState, PhoneScreen } from "../phoneReducer";
import type { ModeTransition } from "../phoneReducer";
import { phoneQueryKeys } from "../model/queryKeys";
import { searchReducer, initialSearchState } from "../model/searchModel";

type SearchControllerDeps = {
  dispatch: (action: PhoneModeAction) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  topBarInputRef: React.RefObject<HTMLInputElement | null>;
  modeRef: React.MutableRefObject<PhoneScreen>;
  bgContentRef: React.MutableRefObject<PhoneBgContent>;
  modeState: PhoneModeState;
  modeTransition: ModeTransition;
};

export type SearchControllerApi = {
  query: string;
  submittedQuery: string;
  dateBrowseContext: { prefix: string; label: string } | null;
  similarSourceItem: RecallMediaItem | null;
  results: RecallMediaItem[];
  isLoading: boolean;
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;
  isLoadingMore: boolean;
  isAutoSearchPending: boolean;
  showHistory: boolean;
  history: string[];
  suggestions: string[];
  showComposePanel: boolean;
  collapseComposePanel: () => void;
  expandComposePanel: () => void;
  hasMore: boolean;
  refinements: string[];
  composeQuery: string;
  composeSuggestions: string[];
  activeHistory: string[];
  visibleHistory: string[];
  liveRef: React.MutableRefObject<{ hasMore: boolean; submittedQuery: string; query: string; visibleCount: number; prefetchedResults: RecallMediaItem[] | null }>;
  updateItem: (updated: RecallMediaItem) => void;
  applyPrefetchedResults: () => void;
  runSearch: (rawQuery: string, count?: number, options?: { remember?: boolean; fromAuto?: boolean }) => Promise<void>;
  runDateBrowse: (datePrefix: string, label: string) => Promise<void>;
  runSimilarById: (item: RecallMediaItem) => Promise<void>;
  clearSimilarSource: () => void;
  loadMore: () => Promise<void>;
  abortActiveSearch: () => void;
  cancelAutoSearch: () => void;
  removeHistoryItem: (item: string) => void;
  clearHistory: () => void;
  resetSearch: () => void;
  handleAssistSearch: (nextQuery: string) => void;
  handleSearchChange: (nextQuery: string) => void;
  handleSearchSubmit: () => void;
  handleSearchClear: () => void;
  handleSearchHistoryToggle: () => void;
  handleSearchFocus: () => void;
  enterComposeMode: (opts?: { showHistory?: boolean }) => void;
  closeComposeMode: () => void;
};

export function useSearchController({
  dispatch, scrollContainerRef, topBarInputRef, modeRef, bgContentRef, modeState, modeTransition,
}: SearchControllerDeps): SearchControllerApi {
  const contentMode = modeState.bgContent;

  const [s, ds] = useReducer(searchReducer, initialSearchState);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const hasPrefetchedRef = useRef(false);
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);

  const hasMore = !s.dateBrowseContext && s.results.length >= s.visibleCount && contentMode === "results";
  const liveRef = useRef({ hasMore, submittedQuery: s.submittedQuery, query: s.query, visibleCount: s.visibleCount, prefetchedResults: s.prefetchedResults });
  liveRef.current = { hasMore, submittedQuery: s.submittedQuery, query: s.query, visibleCount: s.visibleCount, prefetchedResults: s.prefetchedResults };

  const cancelAutoSearch = useCallback(() => {
    if (autoSearchTimerRef.current !== null) { window.clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; }
    ds({ type: "AUTO_SEARCH_PENDING_SET", pending: false });
  }, []);

  const abortActiveSearch = useCallback(() => {
    searchAbortRef.current?.abort(); searchAbortRef.current = null; ds({ type: "SEARCH_ABORT" });
  }, []);

  const runSearch = useCallback(async (rawQuery: string, count = SEARCH_BATCH_SIZE, options: { remember?: boolean; fromAuto?: boolean } = {}) => {
    const q = rawQuery.trim();
    const shouldRemember = options.remember ?? true;
    const fromAuto = options.fromAuto === true;
    if (!q) {
      searchAbortRef.current?.abort(); searchAbortRef.current = null;
      ds({ type: "SEARCH_CLEAR" });
      dispatch({ type: "SEARCH_CLEAR" });
      return;
    }
    searchAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort(); loadMoreAbortRef.current = null;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    ds({ type: "SEARCH_START", submittedQuery: q, count });
    if (fromAuto) dispatch({ type: "AUTOSEARCH_COMMIT" });
    else { dispatch({ type: "SEARCH_COMMIT" }); scrollContainerRef.current?.scrollTo({ top: 0 }); topBarInputRef.current?.blur(); }
    if (shouldRemember) { rememberSearch(q); ds({ type: "HISTORY_SET", history: readSearchHistory() }); }
    try {
      const [sr, tr] = await Promise.allSettled([searchSemantic(q, count, { signal: controller.signal }), searchText(q, Math.min(count, 30), { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const nextResults = mergeResults(sr.status === "fulfilled" ? sr.value.results : [], tr.status === "fulfilled" ? tr.value.results : []).slice(0, count);
      if (nextResults.length > 0) ds({ type: "SEARCH_SUCCESS", results: nextResults });
      else if (sr.status === "rejected" && tr.status === "rejected") {
        if (import.meta.env.DEV) ds({ type: "SEARCH_SUCCESS", results: Array.from({ length: SEARCH_BATCH_SIZE }).map((_, i) => makeMockItem(`${q}-${i}`, q)) });
        ds({ type: "SET_ERROR", message: "Backend unavailable. Showing sample tiles until the media bundle is indexed." });
      } else ds({ type: "SEARCH_SUCCESS", results: [] });
    } finally { if (!controller.signal.aborted && searchAbortRef.current === controller) ds({ type: "SEARCH_ABORT" }); }
  }, [dispatch, scrollContainerRef, topBarInputRef]);

  const runDateBrowse = useCallback(async (datePrefix: string, label: string) => {
    searchAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort(); loadMoreAbortRef.current = null;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    ds({ type: "DATE_BROWSE_START", prefix: datePrefix, label });
    dispatch({ type: "SEARCH_COMMIT" }); scrollContainerRef.current?.scrollTo({ top: 0 }); topBarInputRef.current?.blur();
    try {
      const response = await listItemsByDate(datePrefix, "asc", { signal: controller.signal });
      if (controller.signal.aborted) return;
      ds({ type: "DATE_BROWSE_SUCCESS", results: response.results });
    } catch {
      if (!controller.signal.aborted) ds({ type: "DATE_BROWSE_ERROR" });
    } finally {
      if (!controller.signal.aborted && searchAbortRef.current === controller) ds({ type: "SEARCH_ABORT" });
    }
  }, [dispatch, scrollContainerRef, topBarInputRef]);

  const runSimilarById = useCallback(async (item: RecallMediaItem) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    ds({ type: "SIMILAR_START", item });
    dispatch({ type: "SIMILAR_SEARCH" }); scrollContainerRef.current?.scrollTo({ top: 0 });
    try {
      const response = await searchSimilarById(item.id, SEARCH_BATCH_SIZE, { signal: controller.signal });
      if (controller.signal.aborted) return;
      ds({ type: "SIMILAR_SUCCESS", results: response.results });
    } catch { if (!controller.signal.aborted) ds({ type: "SIMILAR_ERROR" }); }
    finally { if (!controller.signal.aborted && searchAbortRef.current === controller) ds({ type: "SEARCH_ABORT" }); }
  }, [dispatch, scrollContainerRef]);

  const prefetchNextBatch = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, visibleCount: vc } = liveRef.current;
    if (!live || s.dateBrowseContext || hasPrefetchedRef.current || !sq) return;
    hasPrefetchedRef.current = true;
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [sr, tr] = await Promise.allSettled([searchSemantic(sq, nextCount, { signal: controller.signal }), searchText(sq, Math.min(nextCount, 30), { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const nextResults = mergeResults(sr.status === "fulfilled" ? sr.value.results : [], tr.status === "fulfilled" ? tr.value.results : []).slice(0, nextCount);
      if (nextResults.length > 0) ds({ type: "PREFETCH_SUCCESS", results: nextResults });
    } catch { if (!controller.signal.aborted) hasPrefetchedRef.current = false; }
  }, [s.dateBrowseContext]);

  const applyPrefetchedResults = useCallback(() => {
    const { prefetchedResults: cached, visibleCount: vc } = liveRef.current;
    if (!cached) return;
    ds({ type: "PREFETCH_APPLY", nextCount: vc + SEARCH_BATCH_SIZE });
    hasPrefetchedRef.current = false;
  }, []);

  const loadMore = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, query: q, visibleCount: vc, prefetchedResults: cached } = liveRef.current;
    if (!live) return;
    if (cached) { applyPrefetchedResults(); return; }
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    ds({ type: "LOAD_MORE_START" });
    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [sr, tr] = await Promise.allSettled([searchSemantic(sq || q, nextCount, { signal: controller.signal }), searchText(sq || q, Math.min(nextCount, 30), { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      const nextResults = mergeResults(sr.status === "fulfilled" ? sr.value.results : [], tr.status === "fulfilled" ? tr.value.results : []).slice(0, nextCount);
      if (nextResults.length > 0) ds({ type: "LOAD_MORE_SUCCESS", results: nextResults, nextCount });
      else ds({ type: "LOAD_MORE_END" });
    } finally { if (!controller.signal.aborted) ds({ type: "LOAD_MORE_END" }); }
  }, [applyPrefetchedResults]);

  const removeHistoryItem = useCallback((item: string) => {
    writeSearchHistory(s.history.filter((h) => h.toLowerCase() !== item.toLowerCase()));
    ds({ type: "HISTORY_REMOVE", item });
  }, [s.history]);

  const clearHistory = useCallback(() => { writeSearchHistory([]); ds({ type: "HISTORY_CLEAR" }); }, []);

  const collapseComposePanel = useCallback(() => ds({ type: "COMPOSE_PANEL_SET", show: false }), []);
  const expandComposePanel = useCallback(() => ds({ type: "COMPOSE_PANEL_SET", show: true }), []);

  const updateItem = useCallback((updated: RecallMediaItem) => {
    ds({ type: "ITEM_UPDATE", updated });
  }, []);

  const clearSimilarSource = useCallback(() => ds({ type: "SIMILAR_CLEAR" }), []);

  const setErrorMessage = useCallback((msg: string | null) => ds({ type: "SET_ERROR", message: msg }), []);

  const resetSearch = useCallback(() => {
    abortActiveSearch();
    cancelAutoSearch();
    ds({ type: "SEARCH_CLEAR" });
    dispatch({ type: "SEARCH_CLEAR" });
    topBarInputRef.current?.blur();
  }, [abortActiveSearch, cancelAutoSearch, dispatch, topBarInputRef]);

  const enterComposeMode = useCallback((opts: { showHistory?: boolean } = {}) => {
    if (modeRef.current !== "compose") dispatch({ type: "SEARCH_FOCUS", startQuery: s.query });
    ds({ type: "COMPOSE_PANEL_SET", show: true });
    if (typeof opts.showHistory === "boolean") ds({ type: "SHOW_HISTORY_SET", show: opts.showHistory });
  }, [s.query, dispatch, modeRef]);

  const closeComposeMode = useCallback(() => {
    ds({ type: "QUERY_CHANGE", query: modeState.composeStartQuery });
    ds({ type: "SHOW_HISTORY_SET", show: false });
    ds({ type: "HISTORY_SET", history: readSearchHistory() });
    dispatch({ type: "COMPOSE_DISMISS" });
    topBarInputRef.current?.blur();
  }, [modeState.composeStartQuery, dispatch, topBarInputRef]);

  const handleAssistSearch = useCallback((nextQuery: string) => {
    ds({ type: "SHOW_HISTORY_SET", show: false });
    ds({ type: "QUERY_CHANGE", query: nextQuery });
    void runSearch(nextQuery);
  }, [runSearch]);

  const handleSearchHistoryToggle = useCallback(() => {
    if (modeRef.current !== "compose") { enterComposeMode({ showHistory: true }); return; }
    ds({ type: "SHOW_HISTORY_SET", show: !s.showHistory });
  }, [enterComposeMode, modeRef, s.showHistory]);

  const handleSearchFocus = useCallback(() => { enterComposeMode(); }, [enterComposeMode]);

  const handleSearchChange = useCallback((nextQuery: string) => {
    if (nextQuery === "" && bgContentRef.current === "results") {
      cancelAutoSearch(); abortActiveSearch();
      ds({ type: "SEARCH_CLEAR" });
      dispatch({ type: "SEARCH_CLEAR" });
      topBarInputRef.current?.blur();
      return;
    }
    ds({ type: "QUERY_CHANGE", query: nextQuery });
    ds({ type: "SHOW_HISTORY_SET", show: false });
    if (nextQuery) ds({ type: "COMPOSE_PANEL_SET", show: true });
    if (modeRef.current !== "compose") enterComposeMode();
  }, [abortActiveSearch, cancelAutoSearch, enterComposeMode, dispatch, bgContentRef, modeRef, topBarInputRef]);

  const handleSearchSubmit = useCallback(() => {
    cancelAutoSearch(); void runSearch(s.query);
  }, [cancelAutoSearch, s.query, runSearch]);

  const handleSearchClear = useCallback(() => {
    cancelAutoSearch(); abortActiveSearch();
    if (modeRef.current === "compose" && bgContentRef.current !== "results") {
      ds({ type: "QUERY_CHANGE", query: "" });
      ds({ type: "SHOW_HISTORY_SET", show: true });
      return;
    }
    ds({ type: "SEARCH_CLEAR" });
    dispatch({ type: "SEARCH_CLEAR" });
    topBarInputRef.current?.blur();
  }, [abortActiveSearch, cancelAutoSearch, dispatch, bgContentRef, modeRef, topBarInputRef]);

  const recentItemsQuery = useQuery({
    queryKey: phoneQueryKeys.recent(SEARCH_BATCH_SIZE),
    queryFn: () => listRecentItems(SEARCH_BATCH_SIZE),
    enabled: !s.submittedQuery,
  });

  // Debounce query for suggestions
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(s.query.trim()), SUGGESTION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [s.query]);

  const suggestionsQuery = useQuery({
    queryKey: phoneQueryKeys.suggestions(debouncedQuery),
    queryFn: () => suggestSearches(debouncedQuery, 6),
    enabled: !!debouncedQuery,
    staleTime: 60_000,
  });

  // Auto-search debounce
  useEffect(() => {
    if (autoSearchTimerRef.current !== null) { clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; }
    const q = s.query.trim();
    if (modeRef.current !== "compose" || q.length < 2) { ds({ type: "AUTO_SEARCH_PENDING_SET", pending: false }); return; }
    ds({ type: "AUTO_SEARCH_PENDING_SET", pending: true });
    autoSearchTimerRef.current = setTimeout(() => {
      autoSearchTimerRef.current = null; ds({ type: "AUTO_SEARCH_PENDING_SET", pending: false });
      void runSearch(q, SEARCH_BATCH_SIZE, { remember: false, fromAuto: true });
    }, AUTOSEARCH_DEBOUNCE_MS);
    return () => { if (autoSearchTimerRef.current !== null) { clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; } ds({ type: "AUTO_SEARCH_PENDING_SET", pending: false }); };
  }, [s.query, runSearch, modeRef]);

  // Scroll to top on search-clear
  useEffect(() => {
    if (modeTransition.reason === "search-clear") scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [modeTransition, scrollContainerRef]);

  // Reset prefetch state when submitted query changes
  useEffect(() => {
    hasPrefetchedRef.current = false; ds({ type: "PREFETCH_CLEAR" }); prefetchAbortRef.current?.abort(); prefetchAbortRef.current = null;
  }, [s.submittedQuery]);

  // Prefetch-on-scroll (results mode)
  useEffect(() => {
    const el = scrollContainerRef.current;
    const mode = modeRef.current;
    if (!el || mode !== "results") return;
    const handleScroll = () => { if (el.scrollHeight - el.scrollTop - el.clientHeight < PREFETCH_TRIGGER_REMAINING) void prefetchNextBatch(); };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeState.screen]);

  const suggestions = useMemo<string[]>(() => {
    if (!debouncedQuery) return s.history.slice(0, 5);
    const remote = suggestionsQuery.data?.suggestions ?? [];
    const combined = [...remote, ...localSuggestions(debouncedQuery, s.history)];
    return combined.filter((item, idx, all) => all.findIndex((c) => c.toLowerCase() === item.toLowerCase()) === idx).slice(0, 6);
  }, [debouncedQuery, suggestionsQuery.data, s.history]);

  const refinements = useMemo(() => suggestions.filter((sug) => sug.toLowerCase() !== s.submittedQuery.toLowerCase()).slice(0, 4), [suggestions, s.submittedQuery]);
  const visibleHistory = s.history.length > 0 ? s.history : readSearchHistory();
  const activeHistory = s.showHistory ? readSearchHistory() : visibleHistory;
  const composeQuery = s.query.trim();
  const composeSuggestions = composeQuery ? suggestions.slice(0, 3) : [];

  const effectiveResults = useMemo<RecallMediaItem[]>(() => {
    if (s.submittedQuery) return s.results;
    if (recentItemsQuery.data?.results.length) return recentItemsQuery.data.results;
    if (recentItemsQuery.isError && import.meta.env.DEV)
      return Array.from({ length: SEARCH_BATCH_SIZE }).map((_, i) => makeMockItem(`recent-${i}`));
    return [];
  }, [s.submittedQuery, s.results, recentItemsQuery.data, recentItemsQuery.isError]);

  const effectiveIsLoading = s.isLoading || (!s.submittedQuery && recentItemsQuery.isPending);

  return {
    query: s.query, submittedQuery: s.submittedQuery, dateBrowseContext: s.dateBrowseContext,
    similarSourceItem: s.similarSourceItem, results: effectiveResults,
    isLoading: effectiveIsLoading, errorMessage: s.errorMessage, setErrorMessage,
    isLoadingMore: s.isLoadingMore, isAutoSearchPending: s.isAutoSearchPending,
    showHistory: s.showHistory, history: s.history, suggestions,
    showComposePanel: s.showComposePanel, collapseComposePanel, expandComposePanel,
    hasMore, refinements, composeQuery, composeSuggestions, activeHistory, visibleHistory,
    liveRef, updateItem, applyPrefetchedResults,
    runSearch, runDateBrowse, runSimilarById, clearSimilarSource, loadMore, abortActiveSearch, cancelAutoSearch,
    removeHistoryItem, clearHistory, resetSearch,
    handleAssistSearch, handleSearchChange, handleSearchSubmit, handleSearchClear,
    handleSearchHistoryToggle, handleSearchFocus,
    enterComposeMode, closeComposeMode,
  };
}
