import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isVideo, resolvedMediaUrl } from "@/shared/media/mediaItem";
import {
  SEARCH_BATCH_SIZE, FAVORITES_COUNT, OVERSCROLL_THRESHOLD, mediaLayoutId,
  LONG_PRESS_MS, LONG_PRESS_CANCEL_DIST_SQ, SELECTION_SUPPRESS_MS, HIDE_COMPOSE_SCROLL_THRESHOLD,
  MOTION_EASE, readLongPressHintDismissed, writeLongPressHintDismissed,
} from "./phoneUtils";
import { AboutSheet } from "./AboutSheet";
import { HiddenDialog } from "./HiddenDialog";
import { ImageDetailView } from "./ImageDetailView";
import { SelectionTray } from "./SelectionTray";
import { VideoDetailView } from "./VideoDetailView";
import { useQuery } from "@tanstack/react-query";
import { listFavoriteItems } from "../api/searchApi";
import {
  initialPhoneModeState, phoneModeReducer,
  type PhoneScreen,
} from "../phoneReducer";
import { PhoneSearchBar } from "./SearchCommandLayer";
import { useGridDensity } from "./useGridDensity";
import { useHiddenReveal } from "./useHiddenReveal";
import { usePhoneDetail } from "./usePhoneDetail";
import { useSelectionTray } from "./useSelectionTray";
import { PhoneSearchShell } from "./PhoneSearchShell";
import { PhoneHomeHeader } from "./PhoneHomeHeader";
import { SettingsSheet } from "./SettingsSheet";
import { IndexedAlbumsSheet } from "./IndexedAlbumsSheet";
import { useIndexedAlbums } from "./useIndexedAlbums";
import { HomeLayer } from "./HomeLayer";
import { ResultsLayer } from "./ResultsLayer";
import { LongPressHint } from "./LongPressHint";
import { GridHandlersContext } from "./GridHandlersContext";
import { useSearchController } from "./useSearchController";

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

  const favoritesQuery = useQuery({
    queryKey: ["catalog", "favorites", FAVORITES_COUNT],
    queryFn: () => listFavoriteItems(FAVORITES_COUNT),
  });
  const favoriteItems = favoritesQuery.data?.results ?? [];
  const isLoadingFavorites = favoritesQuery.isPending;
  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);
  const [showLongPressHint, setShowLongPressHint] = useState(false);
  const hasShownHintRef = useRef(false);
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [detailNavDirection, setDetailNavDirection] = useState<-1 | 0 | 1>(0);
  const indexedAlbums = useIndexedAlbums();
  const [overscrollProgress, setOverscrollProgress] = useState(0);
  const [pullDismissing, setPullDismissing] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const phoneRectRef = useRef<HTMLDivElement>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<PhoneMode>("home");
  const bgContentRef = useRef(contentMode);
  bgContentRef.current = contentMode;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchGridRef = useRef<HTMLDivElement>(null);
  const favoritesGridRef = useRef<HTMLDivElement>(null);


  const { isItemBlurred, hiddenPendingItem, setHiddenPendingItem, revealOne, revealAll, revealSafe } = useHiddenReveal();
  const { toggleSelected } = useSelectionTray(selectedItems, setSelectedItems);

  const sc = useSearchController({ dispatch, scrollContainerRef, topBarInputRef, modeRef, bgContentRef, modeState, modeTransition });

  const handleItemUpdated = useCallback((updated: RecallMediaItem) => {
    sc.updateItem(updated);
    setSelectedItems((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    setAboutSheetItem((prev) => prev?.id === updated.id ? updated : prev);
  }, [sc.updateItem]);

  const { detailItem, setDetailItem, openDetail, closeDetail, handleToggleFavorite, handleToggleSafety, searchSameDate } = usePhoneDetail({
    isItemBlurred, onSelectCandidate, modeRef, dispatch,
    runDateBrowse: sc.runDateBrowse, setErrorMessage: sc.setErrorMessage, setNsfwPendingItem: setHiddenPendingItem, revealSafe,
    onItemUpdated: handleItemUpdated,
  });

  const openDetailFromGrid = useCallback((item: RecallMediaItem) => {
    setDetailNavDirection(0);
    openDetail(item);
  }, [openDetail]);

  const closeDetailFromChrome = useCallback(() => {
    setDetailNavDirection(0);
    closeDetail();
  }, [closeDetail]);

  const handleViewHiddenItem = useCallback((item: RecallMediaItem) => {
    if (modeRef.current === "detail") return;
    setDetailNavDirection(0);
    revealOne(item.id);
    dispatch({ type: "DETAIL_OPEN" });
    setDetailItem(item);
    onSelectCandidate?.(item.id);
  }, [revealOne, dispatch, setDetailItem, onSelectCandidate]);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSelectionUntilRef = useRef(0);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    pointerDownPosRef.current = null;
  }, []);

  const suppressTileSelectionBriefly = useCallback(() => {
    suppressSelectionUntilRef.current = (typeof window !== "undefined" ? window.performance.now() : Date.now()) + SELECTION_SUPPRESS_MS;
  }, []);

  const isTileSelectionSuppressed = useCallback(() => {
    return (typeof window !== "undefined" ? window.performance.now() : Date.now()) < suppressSelectionUntilRef.current;
  }, []);

  const { gridColumns, gridDensityStyle, zoomGridIn, zoomGridOut, pinchHandlers, wheelHandler } = useGridDensity(
    favoritesGridRef, searchGridRef, favoriteItems, sc.results, sc.isLoading, isLoadingFavorites, sc.isLoadingMore, mode,
    cancelLongPress, suppressTileSelectionBriefly,
  );

  const handleItemPointerDown = useCallback((e: React.PointerEvent, item: RecallMediaItem) => {
    e.stopPropagation();
    if (isTileSelectionSuppressed()) { cancelLongPress(); return; }
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    if (!isItemBlurred(item)) {
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true; longPressTimerRef.current = null; openDetailFromGrid(item);
      }, LONG_PRESS_MS);
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, openDetailFromGrid]);

  const handleItemPointerUp = useCallback((_e: React.PointerEvent, item: RecallMediaItem) => {
    cancelLongPress();
    if (isTileSelectionSuppressed()) return;
    if (!longPressTriggeredRef.current) {
      if (isItemBlurred(item)) {
        setHiddenPendingItem(item);
      } else {
        toggleSelected(item);
        if (modeRef.current === "results" && !hasShownHintRef.current && !readLongPressHintDismissed()) {
          hasShownHintRef.current = true;
          setTimeout(() => setShowLongPressHint(true), 400);
        }
      }
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, toggleSelected, setHiddenPendingItem, modeRef]);

  const handleItemPointerMove = useCallback((e: React.PointerEvent) => {
    if (longPressTimerRef.current !== null && pointerDownPosRef.current) {
      const dx = e.clientX - pointerDownPosRef.current.x, dy = e.clientY - pointerDownPosRef.current.y;
      if (dx * dx + dy * dy > LONG_PRESS_CANCEL_DIST_SQ) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    }
  }, []);

  const handleItemPointerCancel = useCallback(() => { cancelLongPress(); }, [cancelLongPress]);

  const usesNaturalAspectGrid = gridColumns === 1;
  const mediaGridClassName = `grid phone-media-grid${usesNaturalAspectGrid ? " phone-media-grid--natural" : ""}`;
  const showSelectionTray = selectedItems.length > 0 && mode !== "detail" && mode !== "compose";

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setDetailItem(null);
    setSelectedItems([]);
    if (modeRef.current === "detail") dispatch({ type: "TARGET_RESET" });
  }, [currentTarget?.id, dispatch, setDetailItem]);

  useEffect(() => { if (mode === "compose") topBarInputRef.current?.focus(); modeRef.current = mode; }, [contentMode, mode]);

  // Reset header visibility when returning to home
  const [isAtScrollTop, setIsAtScrollTop] = useState(true);
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
  }, [detailItem?.id, mode]);

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
    // Start at actual scroll position so momentum events that fired before this
    // effect ran don't look like a downward scroll from 0.
    let prevScrollTop = el.scrollTop;
    // Absorb residual momentum scroll events that occur right after the user taps
    // the search bar to enter compose — without this, those events race with the
    // mode change and immediately dismiss compose or collapse the panel.
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

  // Overscroll-to-load-more physics (touch)
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
      if (delta >= OVERSCROLL_THRESHOLD && sc.liveRef.current.hasMore) {
        setPullDismissing(true);
        setTimeout(() => setPullDismissing(false), 200);
        const { prefetchedResults: cached, visibleCount: vc } = sc.liveRef.current;
        if (cached) { sc.setResults(cached); sc.setVisibleCount(vc + SEARCH_BATCH_SIZE); sc.setErrorMessage(null); }
        else { void sc.loadMore(); }
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
    setDetailNavDirection(0);
    setDetailItem(null);
    await sc.runSimilarById(item);
  }, [setDetailItem, sc.runSimilarById]);

  const handleSimilarChipTap = useCallback(() => {
    sc.clearSimilarSource();
    sc.enterComposeMode({ showHistory: true });
  }, [sc.clearSimilarSource, sc.enterComposeMode]);

  const searchSameDateFromDetail = useCallback((item: RecallMediaItem) => {
    setDetailNavDirection(0);
    searchSameDate(item);
  }, [searchSameDate]);

  const navigateDetail = useCallback((direction: 1 | -1) => {
    if (!detailItem) return;
    const source = bgContentRef.current === "results" ? sc.results : favoriteItems;
    const currentIndex = source.findIndex((item) => item.id === detailItem.id);
    if (currentIndex < 0) return;
    const candidate = source[currentIndex + direction];
    if (candidate) {
      setDetailNavDirection(direction);
      setDetailItem(candidate);
      if (!isItemBlurred(candidate)) onSelectCandidate?.(candidate.id);
    }
  }, [detailItem, favoriteItems, isItemBlurred, onSelectCandidate, sc.results, setDetailItem]);

  const detailSource = useMemo(
    () => (contentMode === "results" ? sc.results : favoriteItems),
    [contentMode, favoriteItems, sc.results],
  );

  const detailIndex = useMemo(
    () => detailItem ? detailSource.findIndex((item) => item.id === detailItem.id) : -1,
    [detailItem, detailSource],
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
    if (detailItem?.id === item.id) onSelectCandidate?.(item.id);
  }, [detailItem?.id, onSelectCandidate, revealOne]);

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

  const renderSearchBar = (className?: string, clearLabel = "Clear search") => (
    <PhoneSearchBar ref={topBarInputRef} value={sc.query} className={className} clearLabel={clearLabel}
      showHistory={sc.showHistory} showHistoryIcon={showHistoryIcon} isSearching={isSearching}
      dateBrowseLabel={mode === "results" ? sc.dateBrowseContext?.label : null}
      similarThumbnailUrl={mode === "results" && sc.similarSourceItem
        ? (sc.similarSourceItem.links?.thumbnail ?? null)
        : undefined}
      onSimilarChipTap={handleSimilarChipTap}
      onToggleHistory={sc.handleSearchHistoryToggle} onFocus={sc.handleSearchFocus}
      onChange={sc.handleSearchChange} onSubmit={sc.handleSearchSubmit} onClear={sc.handleSearchClear} />
  );

  return (
    <GridHandlersContext.Provider value={{
      selectedItems, isItemBlurred,
      onPointerDown: handleItemPointerDown, onPointerUp: handleItemPointerUp,
      onPointerMove: handleItemPointerMove, onPointerCancel: handleItemPointerCancel,
      toggleSelected, pinchHandlers, gridColumns, zoomGridIn, zoomGridOut,
      mediaGridClassName, naturalAspectRatio: usesNaturalAspectGrid,
    }}>
    <div ref={phoneRectRef}
      className={`phone-rect${contentMode === "home" ? " phone-rect--home" : ""}${showSelectionTray ? " phone-rect--has-selection" : ""}`}
      style={gridDensityStyle} data-reduced-motion={prefersReducedMotion ? "true" : undefined}
      aria-label="Phone interface viewport"
      tabIndex={0}
      onKeyDown={(event) => {
        if (modeRef.current === "detail") {
          if (event.key === "ArrowLeft") { event.preventDefault(); navigateDetail(-1); return; }
          if (event.key === "ArrowRight") { event.preventDefault(); navigateDetail(1); return; }
          if (event.key === "Escape") { event.preventDefault(); closeDetailFromChrome(); return; }
        }
        if (event.key === "Escape" && modeRef.current === "compose") { sc.closeComposeMode(); return; }
        if (event.key === "Escape" && mode !== "home") sc.resetSearch();
      }}
    >
      {mode === "results" && sc.hasMore ? (
        <div className={`pull-indicator${overscrollProgress > 0 ? " pull-indicator--visible" : ""}${overscrollProgress >= 1 ? " pull-indicator--ready" : ""}${pullDismissing ? " pull-indicator--dismissing" : ""}`} aria-hidden>
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
              <PhoneHomeHeader onExit={onExit} onOpenSettings={() => setSettingsOpen(true)} />
            </motion.div>
          )}
        </AnimatePresence>

        <PhoneSearchShell
          mode={mode} query={sc.query}
          showHistory={sc.showHistory} activeHistory={sc.activeHistory}
          composeSuggestions={sc.composeSuggestions} visibleHistory={sc.visibleHistory}
          isSearching={isSearching} showComposePanel={sc.showComposePanel}
          onAssistSearch={sc.handleAssistSearch} onClearHistory={sc.clearHistory}
          onRemoveHistoryItem={sc.removeHistoryItem} renderSearchBar={renderSearchBar}
        />

        <ScrollArea className="phone-rect-content" viewportRef={scrollContainerRef} viewportClassName="phone-rect-viewport"
          onPointerDownCapture={mode === "compose" && contentMode !== "home" ? () => dispatch({ type: "COMPOSE_DISMISS" }) : undefined}>
          <>
            <HomeLayer visible={contentMode === "home"} modeTransition={modeTransition}
              favoriteItems={favoriteItems} favoritesGridRef={favoritesGridRef} isLoadingFavorites={isLoadingFavorites} />
            <ResultsLayer visible={contentMode === "results"} mode={mode} contentMode={contentMode}
              isLoading={sc.isLoading} isLoadingMore={sc.isLoadingMore} modeTransition={modeTransition}
              results={sc.results} searchGridRef={searchGridRef}
              submittedQuery={sc.submittedQuery} errorMessage={sc.errorMessage} hasMore={sc.hasMore}
              isDateBrowse={!!sc.dateBrowseContext}
              refinements={sc.refinements}
              loadMore={() => void sc.loadMore()}
              onRunRefinement={(refinement) => { sc.setQuery(refinement); void sc.runSearch(refinement); }} />
          </>
        </ScrollArea>

        <AnimatePresence initial={false}>
          {mode === "detail" && detailItem && (
            <motion.div
              key="detail-backdrop"
              className="detail-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: MOTION_EASE.gentle }}
              aria-hidden
            />
          )}
        </AnimatePresence>

        <AnimatePresence initial={false} custom={mode === "detail" ? detailNavDirection : 0}>
          {mode === "detail" && detailItem && (
            isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
              <VideoDetailView key={detailItem.id} item={detailItem} onBack={closeDetailFromChrome} onSearchSameDate={searchSameDateFromDetail}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)} onConfirmAnswer={handleConfirmAnswer}
                onSendSelection={sendSelection} onToggleFavorite={handleToggleFavorite} onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem} onNavigate={navigateDetail}
                canNavigatePrevious={canNavigateDetailPrevious} canNavigateNext={canNavigateDetailNext}
                isSensitiveHidden={isItemBlurred(detailItem)} onRevealSensitive={handleRevealDetailSensitive}
                previousPreview={previousDetailPreview} nextPreview={nextDetailPreview}
                navigationDirection={detailNavDirection}
                layoutId={mediaLayoutId(detailItem.id)} />
            ) : (
              <ImageDetailView key={detailItem.id} item={detailItem} onBack={closeDetailFromChrome} onSearchSameDate={searchSameDateFromDetail}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)} onConfirmAnswer={handleConfirmAnswer}
                onSendSelection={sendSelection} onToggleFavorite={handleToggleFavorite} onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem} onNavigate={navigateDetail}
                canNavigatePrevious={canNavigateDetailPrevious} canNavigateNext={canNavigateDetailNext}
                isSensitiveHidden={isItemBlurred(detailItem)} onRevealSensitive={handleRevealDetailSensitive}
                previousPreview={previousDetailPreview} nextPreview={nextDetailPreview}
                navigationDirection={detailNavDirection}
                layoutId={mediaLayoutId(detailItem.id)} />
            )
          )}
        </AnimatePresence>

      </LayoutGroup>
      </MotionConfig>

      {hiddenPendingItem && (
        <HiddenDialog item={hiddenPendingItem} onKeepHidden={() => setHiddenPendingItem(null)}
          onViewItem={handleViewHiddenItem} onRevealAll={revealAll} />
      )}

      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>
          {aboutSheetItem && <AboutSheet item={aboutSheetItem} onClose={() => setAboutSheetItem(null)} />}
        </AnimatePresence>
      </MotionConfig>

      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>
          {settingsOpen && (
            <SettingsSheet
              key="settings-sheet"
              onClose={() => setSettingsOpen(false)}
              indexedAlbumCount={indexedAlbums.count}
              indexedAlbumTotal={indexedAlbums.total}
              gridColumns={gridColumns}
              onOpenIndexedAlbums={() => setAlbumsOpen(true)}
              onRevealAll={revealAll}
              escapeDisabled={albumsOpen}
            />
          )}
          {albumsOpen && (
            <IndexedAlbumsSheet
              key="albums-sheet"
              initialSelectedIds={indexedAlbums.selectedIds}
              onCancel={() => setAlbumsOpen(false)}
              onSave={(ids) => {
                indexedAlbums.save(ids);
                setAlbumsOpen(false);
              }}
            />
          )}
        </AnimatePresence>
      </MotionConfig>

      <MotionConfig reducedMotion="user">
        {showSelectionTray && (
          <SelectionTray selectedItems={selectedItems} toggleSelected={toggleSelected}
            onConfirmAnswer={handleConfirmAnswer} onClearSelection={() => setSelectedItems([])} />
        )}
        <LongPressHint visible={showLongPressHint} onDismiss={() => {
          writeLongPressHintDismissed();
          setShowLongPressHint(false);
        }} />
      </MotionConfig>
    </div>
    </GridHandlersContext.Provider>
  );
}
