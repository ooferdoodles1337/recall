import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isVideo, resolvedMediaUrl } from "@/shared/media/mediaItem";
import {
  HIDE_COMPOSE_SCROLL_THRESHOLD,
  mediaLayoutId,
  readSearchPulseDismissed, writeSearchPulseDismissed,
} from "../phoneUtils";
import { initialPhoneModeState, phoneModeReducer, type PhoneScreen } from "../phoneReducer";
import { useGridDensity } from "./useGridDensity";
import { useHiddenReveal } from "./useHiddenReveal";
import { useHomeFeed } from "./useHomeFeed";
import { useIndexedAlbums } from "./useIndexedAlbums";
import { useMediaGridSelection } from "./useMediaGridSelection";
import { usePhoneDetail } from "./usePhoneDetail";
import { useResultsPullToLoadMore } from "./useResultsPullToLoadMore";
import { useScrollContainment } from "./useScrollContainment";
import { useSearchController } from "./useSearchController";
import { useViewportBottomInset } from "./useViewportBottomInset";
import type { GridHandlers } from "../components/grid/GridHandlersContext";

export interface PhoneControllerProps {
  currentTarget?: RecallMediaItem;
  onSelectCandidate?: (id: string) => void;
  onConfirmAnswer?: (id: string) => void;
  onExit?: () => void;
}

export function usePhoneController({
  currentTarget,
  onSelectCandidate,
  onConfirmAnswer,
  onExit,
}: PhoneControllerProps) {
  useViewportBottomInset();

  const [modeState, dispatch] = useReducer(phoneModeReducer, initialPhoneModeState);
  const mode = modeState.screen;
  const contentMode = modeState.bgContent;
  const modeTransition = modeState.transition;

  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);
  const [showSearchPulse, setShowSearchPulse] = useState(() => !readSearchPulseDismissed());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [isAtScrollTop, setIsAtScrollTop] = useState(true);
  const [detailNavDirection, setDetailNavDirection] = useState<-1 | 0 | 1>(0);
  const prefersReducedMotion = useReducedMotion();

  const phoneRectRef = useRef<HTMLDivElement>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<PhoneScreen>("home");
  const bgContentRef = useRef(contentMode);
  bgContentRef.current = contentMode;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchGridRef = useRef<HTMLDivElement>(null);
  const homeGridRef = useRef<HTMLDivElement>(null);

  useScrollContainment(phoneRectRef);
  const indexedAlbums = useIndexedAlbums();

  const handleHomeFeedSwitchItems = useCallback((nextItems: RecallMediaItem[]) => {
    const nextIds = new Set(nextItems.map((item) => item.id));
    setSelectedItems((prev) => prev.filter((item) => nextIds.has(item.id)));
  }, []);

  const {
    feed: homeFeed,
    items: activeHomeItems,
    isLoading: isLoadingHomeFeed,
    isLoadingMore: isLoadingMoreRecents,
    changeFeed: handleHomeFeedChange,
  } = useHomeFeed({
    contentMode,
    scrollContainerRef,
    onFeedSwitchItems: handleHomeFeedSwitchItems,
    onScrollRestored: (scrollTop) => setIsAtScrollTop(scrollTop <= 4),
  });

  const { isItemBlurred, hiddenPendingItem, setHiddenPendingItem, revealOne, revealAll, revealSafe } = useHiddenReveal();

  const sc = useSearchController({ dispatch, scrollContainerRef, topBarInputRef, modeRef, bgContentRef, modeState, modeTransition });

  const { overscrollProgress, pullDismissing } = useResultsPullToLoadMore({
    liveRef: sc.liveRef,
    loadMore: sc.loadMore,
    applyPrefetchedResults: sc.applyPrefetchedResults,
    mode,
    scrollContainerRef,
  });

  const handleItemUpdated = useCallback((updated: RecallMediaItem) => {
    sc.updateItem(updated);
    setSelectedItems((prev) => prev.map((item) => item.id === updated.id ? updated : item));
  }, [sc.updateItem]);

  const detail = usePhoneDetail({
    isItemBlurred, onSelectCandidate, modeRef, dispatch,
    runDateBrowse: sc.runDateBrowse, setErrorMessage: sc.setErrorMessage, setHiddenPendingItem, revealSafe,
    onItemUpdated: handleItemUpdated,
  });

  const openDetailFromGrid = useCallback((item: RecallMediaItem) => {
    setDetailNavDirection(0);
    detail.openDetail(item);
  }, [detail.openDetail]);

  const closeDetailFromChrome = useCallback(() => {
    setDetailNavDirection(0);
    detail.closeDetail();
  }, [detail.closeDetail]);

  const handleViewHiddenItem = useCallback((item: RecallMediaItem) => {
    if (modeRef.current === "detail") return;
    setDetailNavDirection(0);
    revealOne(item.id);
    dispatch({ type: "DETAIL_OPEN" });
    detail.setDetailItem(item);
    onSelectCandidate?.(item.id);
  }, [revealOne, dispatch, detail.setDetailItem, onSelectCandidate]);

  const gridSelection = useMediaGridSelection({
    isItemBlurred,
    modeRef,
    onOpenDetail: openDetailFromGrid,
    onReviewHiddenItem: setHiddenPendingItem,
    selectedItems,
    setSelectedItems,
  });

  const { gridColumns, gridDensityStyle, zoomGridIn, zoomGridOut, pinchHandlers, wheelHandler } = useGridDensity(
    gridSelection.cancelLongPress,
    gridSelection.suppressTileSelectionBriefly,
  );

  const usesNaturalAspectGrid = gridColumns === 1;
  const mediaGridClassName = `grid phone-media-grid${usesNaturalAspectGrid ? " phone-media-grid--natural" : ""}`;
  const showSelectionTray = selectedItems.length > 0 && mode !== "detail" && mode !== "compose";

  // Effects

  useEffect(() => {
    detail.setDetailItem(null);
    setSelectedItems([]);
    if (modeRef.current === "detail") dispatch({ type: "TARGET_RESET" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTarget?.id]);

  useEffect(() => {
    if (mode === "compose") topBarInputRef.current?.focus();
    modeRef.current = mode;
  }, [contentMode, mode]);

  useEffect(() => {
    if (!showSearchPulse) return;
    if (mode === "compose" || mode === "results") {
      setShowSearchPulse(false);
      writeSearchPulseDismissed();
    }
  }, [mode, showSearchPulse]);

  useEffect(() => {
    if (contentMode === "home") setIsAtScrollTop(true);
  }, [contentMode]);

  useEffect(() => {
    const el = phoneRectRef.current;
    if (!el) return;
    return wheelHandler(el);
  }, [wheelHandler]);

  useEffect(() => {
    if (mode === "detail") phoneRectRef.current?.focus({ preventScroll: true });
  }, [detail.detailItem?.id, mode]);

  // SR-4: home header hides on scroll, reappears at top
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
    let prevScrollTop = el.scrollTop;
    let graceOver = false;
    const graceTimer = setTimeout(() => { graceOver = true; }, 250);
    const handleScroll = () => {
      if (modeRef.current !== "compose") return;
      const st = el.scrollTop;
      if (!graceOver) { prevScrollTop = st; return; }
      if (bgContentRef.current === "results") {
        if (st > HIDE_COMPOSE_SCROLL_THRESHOLD) sc.collapseComposePanel();
        else if (st <= 0) sc.expandComposePanel();
      } else {
        if (st > prevScrollTop) { dispatch({ type: "COMPOSE_DISMISS" }); topBarInputRef.current?.blur(); }
      }
      prevScrollTop = st;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => { clearTimeout(graceTimer); el.removeEventListener("scroll", handleScroll); };
  }, [mode, dispatch, sc.collapseComposePanel, sc.expandComposePanel]);

  // Navigation

  const runSimilarSearch = useCallback(async (item: RecallMediaItem) => {
    setDetailNavDirection(0);
    detail.setDetailItem(null);
    await sc.runSimilarById(item);
  }, [detail.setDetailItem, sc.runSimilarById]);

  const handleSimilarChipTap = useCallback(() => {
    sc.clearSimilarSource();
    sc.enterComposeMode({ showHistory: true });
  }, [sc.clearSimilarSource, sc.enterComposeMode]);

  const searchSameDateFromDetail = useCallback((item: RecallMediaItem) => {
    setDetailNavDirection(0);
    detail.searchSameDate(item);
  }, [detail.searchSameDate]);

  const navigateDetail = useCallback((direction: 1 | -1) => {
    if (!detail.detailItem) return;
    const source = bgContentRef.current === "results" ? sc.results : activeHomeItems;
    const idx = source.findIndex((item) => item.id === detail.detailItem!.id);
    if (idx < 0) return;
    const candidate = source[idx + direction];
    if (candidate) {
      setDetailNavDirection(direction);
      detail.setDetailItem(candidate);
      if (!isItemBlurred(candidate)) onSelectCandidate?.(candidate.id);
    }
  }, [activeHomeItems, detail.detailItem, detail.setDetailItem, isItemBlurred, onSelectCandidate, sc.results]);

  const detailSource = useMemo(
    () => (contentMode === "results" ? sc.results : activeHomeItems),
    [activeHomeItems, contentMode, sc.results],
  );

  const detailIndex = useMemo(
    () => detail.detailItem ? detailSource.findIndex((item) => item.id === detail.detailItem!.id) : -1,
    [detail.detailItem, detailSource],
  );

  const canNavigateDetailPrevious = detailIndex > 0;
  const canNavigateDetailNext = detailIndex >= 0 && detailIndex < detailSource.length - 1;
  const previousDetailPreview = canNavigateDetailPrevious
    ? { item: detailSource[detailIndex - 1], isSensitiveHidden: isItemBlurred(detailSource[detailIndex - 1]) }
    : null;
  const nextDetailPreview = canNavigateDetailNext
    ? { item: detailSource[detailIndex + 1], isSensitiveHidden: isItemBlurred(detailSource[detailIndex + 1]) }
    : null;

  const handleRevealDetailSensitive = useCallback((item: RecallMediaItem) => {
    revealOne(item.id);
    if (detail.detailItem?.id === item.id) onSelectCandidate?.(item.id);
  }, [detail.detailItem?.id, onSelectCandidate, revealOne]);

  const sendSelection = useCallback((item?: RecallMediaItem) => {
    const next = item && !selectedItems.some((c) => c.id === item.id) ? [...selectedItems, item] : selectedItems;
    setSelectedItems(next);
  }, [selectedItems]);

  const handleConfirmAnswer = useCallback((id: string) => {
    onConfirmAnswer?.(id);
    setSelectedItems([]);
    sc.resetSearch();
  }, [onConfirmAnswer, sc.resetSearch]);

  const isSearching = sc.isAutoSearchPending || (sc.isLoading && mode === "compose");
  const showHistoryIcon = isSearching
    || (mode !== "home" && sc.history.length > 0 && (mode === "results" || sc.query.trim().length > 0));

  const gridContext: GridHandlers = useMemo(() => ({
    selectedItems,
    isItemBlurred,
    onPointerDown: gridSelection.onPointerDown,
    onPointerUp: gridSelection.onPointerUp,
    onPointerMove: gridSelection.onPointerMove,
    onPointerCancel: gridSelection.onPointerCancel,
    toggleSelected: gridSelection.toggleSelected,
    pinchHandlers,
    gridColumns,
    zoomGridIn,
    zoomGridOut,
    mediaGridClassName,
    naturalAspectRatio: usesNaturalAspectGrid,
  }), [
    selectedItems, isItemBlurred,
    gridSelection.onPointerDown, gridSelection.onPointerUp,
    gridSelection.onPointerMove, gridSelection.onPointerCancel,
    gridSelection.toggleSelected, pinchHandlers,
    gridColumns, zoomGridIn, zoomGridOut, mediaGridClassName, usesNaturalAspectGrid,
  ]);

  return {
    // refs
    phoneRectRef, topBarInputRef, scrollContainerRef, homeGridRef, searchGridRef,
    // mode
    mode, contentMode, modeTransition, dispatch,
    // display
    prefersReducedMotion, gridDensityStyle, showSelectionTray, isAtScrollTop,
    // search controller
    sc,
    // computed search state
    isSearching, showHistoryIcon, showSearchPulse,
    // home feed
    homeFeed, activeHomeItems, isLoadingHomeFeed, isLoadingMoreRecents, handleHomeFeedChange,
    // detail
    detail, detailNavDirection,
    isVideo, resolvedMediaUrl, mediaLayoutId,
    closeDetailFromChrome, handleViewHiddenItem,
    runSimilarSearch, handleSimilarChipTap, searchSameDateFromDetail, navigateDetail,
    canNavigateDetailPrevious, canNavigateDetailNext, previousDetailPreview, nextDetailPreview,
    handleRevealDetailSensitive, sendSelection, handleConfirmAnswer,
    // grid
    gridContext,
    gridSelection,
    // hidden reveal
    hiddenPendingItem, setHiddenPendingItem, revealAll,
    // sheets
    settingsOpen, setSettingsOpen, albumsOpen, setAlbumsOpen,
    indexedAlbums,
    // pull-to-load
    overscrollProgress, pullDismissing,
    // exit
    onExit,
  };
}
