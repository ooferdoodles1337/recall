import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RecallMediaItem } from "@/shared/types/recall";
import {
  SEARCH_BATCH_SIZE, makeMockItem, readSearchHistory, writeSearchHistory,
  rememberSearch, mergeResults, localSuggestions,
  AUTOSEARCH_DEBOUNCE_MS, SUGGESTION_DEBOUNCE_MS, PREFETCH_TRIGGER_REMAINING,
} from "./phoneUtils";
import {
  listRecentItems, searchSemantic, searchSimilarById, searchText, suggestSearches,
} from "../api/searchApi";
import type { PhoneModeAction, PhoneBgContent, PhoneModeState, PhoneScreen } from "../phoneReducer";
import type { ModeTransition } from "../phoneReducer";

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
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  submittedQuery: string;
  setSubmittedQuery: React.Dispatch<React.SetStateAction<string>>;
  results: RecallMediaItem[];
  setResults: React.Dispatch<React.SetStateAction<RecallMediaItem[]>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  errorMessage: string | null;
  setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>;
  visibleCount: number;
  setVisibleCount: React.Dispatch<React.SetStateAction<number>>;
  isLoadingMore: boolean;
  isAutoSearchPending: boolean;
  showHistory: boolean;
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
  history: string[];
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
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
  runSearch: (rawQuery: string, count?: number, options?: { remember?: boolean; fromAuto?: boolean }) => Promise<void>;
  runSimilarById: (itemId: string) => Promise<void>;
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

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<RecallMediaItem[]>([]);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SEARCH_BATCH_SIZE);
  const [showHistory, setShowHistory] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isAutoSearchPending, setIsAutoSearchPending] = useState(false);
  const [prefetchedResults, setPrefetchedResults] = useState<RecallMediaItem[] | null>(null);
  const [showComposePanel, setShowComposePanel] = useState(true);

  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const hasPrefetchedRef = useRef(false);
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);

  const hasMore = results.length >= visibleCount && contentMode === "results";
  const liveRef = useRef({ hasMore, submittedQuery, query, visibleCount, prefetchedResults });
  liveRef.current = { hasMore, submittedQuery, query, visibleCount, prefetchedResults };

  const cancelAutoSearch = useCallback(() => {
    if (autoSearchTimerRef.current !== null) { window.clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; }
    setIsAutoSearchPending(false);
  }, []);

  const abortActiveSearch = useCallback(() => {
    searchAbortRef.current?.abort(); searchAbortRef.current = null; setIsLoading(false);
  }, []);

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
      else if (sr.status === "rejected" && tr.status === "rejected") {
        if (import.meta.env.DEV) { setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, i) => makeMockItem(`${q}-${i}`, q))); }
        setErrorMessage("Backend unavailable. Showing sample tiles until the media bundle is indexed.");
      }
      else setResults([]);
      if (shouldRemember) { rememberSearch(q); setHistory(readSearchHistory()); }
    } finally { if (!controller.signal.aborted && searchAbortRef.current === controller) setIsLoading(false); }
  }, [dispatch, scrollContainerRef, topBarInputRef]);

  const runSimilarById = useCallback(async (itemId: string) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsLoading(true); setErrorMessage(null); setResults([]);
    dispatch({ type: "SIMILAR_SEARCH" }); scrollContainerRef.current?.scrollTo({ top: 0 }); setSubmittedQuery("similar items"); setQuery("");
    try {
      const response = await searchSimilarById(itemId, SEARCH_BATCH_SIZE, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(response.results);
    } catch { if (!controller.signal.aborted) { setErrorMessage("Similar search is available after this item has an indexed embedding."); setResults([]); } }
    finally { if (!controller.signal.aborted && searchAbortRef.current === controller) setIsLoading(false); }
  }, [dispatch, scrollContainerRef]);

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

  const removeHistoryItem = useCallback((item: string) => {
    setHistory((prev) => { const next = prev.filter((h) => h.toLowerCase() !== item.toLowerCase()); writeSearchHistory(next); return next; });
  }, []);

  const clearHistory = useCallback(() => { setHistory([]); writeSearchHistory([]); }, []);

  const collapseComposePanel = useCallback(() => setShowComposePanel(false), []);
  const expandComposePanel = useCallback(() => setShowComposePanel(true), []);

  const resetSearch = useCallback(() => {
    abortActiveSearch();
    cancelAutoSearch();
    setQuery("");
    setSubmittedQuery("");
    setResults([]);
    setShowHistory(false);
    setHistory(readSearchHistory());
    dispatch({ type: "SEARCH_CLEAR" });
    topBarInputRef.current?.blur();
  }, [abortActiveSearch, cancelAutoSearch, dispatch, topBarInputRef]);

  const enterComposeMode = useCallback((opts: { showHistory?: boolean } = {}) => {
    if (modeRef.current !== "compose") dispatch({ type: "SEARCH_FOCUS", startQuery: query });
    setShowComposePanel(true);
    if (typeof opts.showHistory === "boolean") setShowHistory(opts.showHistory);
  }, [query, dispatch, modeRef]);

  const closeComposeMode = useCallback(() => {
    setQuery(modeState.composeStartQuery); setShowHistory(false); setHistory(readSearchHistory()); dispatch({ type: "COMPOSE_DISMISS" }); topBarInputRef.current?.blur();
  }, [modeState.composeStartQuery, dispatch, topBarInputRef]);

  const handleAssistSearch = useCallback((nextQuery: string) => {
    setShowHistory(false); setQuery(nextQuery); void runSearch(nextQuery);
  }, [runSearch]);

  const handleSearchHistoryToggle = useCallback(() => {
    if (modeRef.current !== "compose") { enterComposeMode({ showHistory: true }); return; }
    setShowHistory((p) => !p);
  }, [enterComposeMode, modeRef]);

  const handleSearchFocus = useCallback(() => { enterComposeMode(); }, [enterComposeMode]);

  const handleSearchChange = useCallback((nextQuery: string) => {
    if (nextQuery === "" && bgContentRef.current === "results") {
      cancelAutoSearch(); abortActiveSearch(); setQuery(""); setSubmittedQuery(""); setShowHistory(false); setHistory(readSearchHistory());
      dispatch({ type: "SEARCH_CLEAR" }); topBarInputRef.current?.blur(); return;
    }
    setQuery(nextQuery); setShowHistory(false);
    if (nextQuery) setShowComposePanel(true);
    if (modeRef.current !== "compose") enterComposeMode();
  }, [abortActiveSearch, cancelAutoSearch, enterComposeMode, dispatch, bgContentRef, modeRef, topBarInputRef]);

  const handleSearchSubmit = useCallback(() => {
    cancelAutoSearch(); void runSearch(query);
  }, [cancelAutoSearch, query, runSearch]);

  const handleSearchClear = useCallback(() => {
    cancelAutoSearch(); abortActiveSearch();
    if (modeRef.current === "compose" && bgContentRef.current !== "results") { setQuery(""); setShowHistory(true); return; }
    setQuery(""); setSubmittedQuery(""); setShowHistory(false); setHistory(readSearchHistory());
    dispatch({ type: "SEARCH_CLEAR" }); topBarInputRef.current?.blur();
  }, [abortActiveSearch, cancelAutoSearch, dispatch, bgContentRef, modeRef, topBarInputRef]);

  const recentItemsQuery = useQuery({
    queryKey: ["catalog", "recent", SEARCH_BATCH_SIZE],
    queryFn: () => listRecentItems(SEARCH_BATCH_SIZE),
    enabled: !submittedQuery,
  });

  // Debounce query for suggestions
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SUGGESTION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const suggestionsQuery = useQuery({
    queryKey: ["suggestions", debouncedQuery],
    queryFn: () => suggestSearches(debouncedQuery, 6),
    enabled: !!debouncedQuery,
    staleTime: 60_000,
  });

  // Auto-search debounce
  useEffect(() => {
    if (autoSearchTimerRef.current !== null) { clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; }
    const q = query.trim();
    if (modeRef.current !== "compose" || q.length < 2) { setIsAutoSearchPending(false); return; }
    setIsAutoSearchPending(true);
    autoSearchTimerRef.current = setTimeout(() => {
      autoSearchTimerRef.current = null; setIsAutoSearchPending(false);
      void runSearch(q, SEARCH_BATCH_SIZE, { remember: false, fromAuto: true });
    }, AUTOSEARCH_DEBOUNCE_MS);
    return () => { if (autoSearchTimerRef.current !== null) { clearTimeout(autoSearchTimerRef.current); autoSearchTimerRef.current = null; } setIsAutoSearchPending(false); };
  }, [query, runSearch, modeRef]);

  // Scroll to top on search-clear
  useEffect(() => {
    if (modeTransition.reason === "search-clear") scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [modeTransition, scrollContainerRef]);

  // Reset prefetch state when submitted query changes
  useEffect(() => {
    hasPrefetchedRef.current = false; setPrefetchedResults(null); prefetchAbortRef.current?.abort(); prefetchAbortRef.current = null;
  }, [submittedQuery]);

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
    if (!debouncedQuery) return history.slice(0, 5);
    const remote = suggestionsQuery.data?.suggestions ?? [];
    const combined = [...remote, ...localSuggestions(debouncedQuery, history)];
    return combined.filter((item, idx, all) => all.findIndex((c) => c.toLowerCase() === item.toLowerCase()) === idx).slice(0, 6);
  }, [debouncedQuery, suggestionsQuery.data, history]);

  const refinements = useMemo(() => suggestions.filter((s) => s.toLowerCase() !== submittedQuery.toLowerCase()).slice(0, 4), [suggestions, submittedQuery]);
  const visibleHistory = history.length > 0 ? history : readSearchHistory();
  const activeHistory = showHistory ? readSearchHistory() : visibleHistory;
  const composeQuery = query.trim();
  const composeSuggestions = composeQuery ? suggestions.slice(0, 3) : [];

  const effectiveResults = useMemo<RecallMediaItem[]>(() => {
    if (submittedQuery) return results;
    if (recentItemsQuery.data?.results.length) return recentItemsQuery.data.results;
    if (recentItemsQuery.isError && import.meta.env.DEV)
      return Array.from({ length: SEARCH_BATCH_SIZE }).map((_, i) => makeMockItem(`recent-${i}`));
    return [];
  }, [submittedQuery, results, recentItemsQuery.data, recentItemsQuery.isError]);

  const effectiveIsLoading = isLoading || (!submittedQuery && recentItemsQuery.isPending);

  return {
    query, setQuery, submittedQuery, setSubmittedQuery, results: effectiveResults, setResults,
    isLoading: effectiveIsLoading, setIsLoading, errorMessage, setErrorMessage,
    visibleCount, setVisibleCount, isLoadingMore, isAutoSearchPending,
    showHistory, setShowHistory, history, setHistory, suggestions,
    showComposePanel, collapseComposePanel, expandComposePanel,
    hasMore, refinements, composeQuery, composeSuggestions, activeHistory, visibleHistory,
    liveRef,
    runSearch, runSimilarById, loadMore, abortActiveSearch, cancelAutoSearch,
    removeHistoryItem, clearHistory, resetSearch,
    handleAssistSearch, handleSearchChange, handleSearchSubmit, handleSearchClear,
    handleSearchHistoryToggle, handleSearchFocus,
    enterComposeMode, closeComposeMode,
  };
}
