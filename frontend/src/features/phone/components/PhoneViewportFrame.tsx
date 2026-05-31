import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isVideo, resolvedMediaUrl } from "@/shared/media/mediaItem";
import {
  SEARCH_BATCH_SIZE, FAVORITES_COUNT, OVERSCROLL_THRESHOLD, mediaLayoutId, readSearchHistory,
  LONG_PRESS_MS, LONG_PRESS_CANCEL_DIST_SQ, SELECTION_SUPPRESS_MS, HIDE_COMPOSE_SCROLL_THRESHOLD,
} from "./phoneUtils";
import { AboutSheet } from "./AboutSheet";
import { NsfwDialog } from "./NsfwDialog";
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
import { useNsfwReveal } from "./useNsfwReveal";
import { usePhoneDetail } from "./usePhoneDetail";
import { useSelectionTray } from "./useSelectionTray";
import { PhoneSearchShell } from "./PhoneSearchShell";
import { PhoneHomeHeader } from "./PhoneHomeHeader";
import { SettingsSheet } from "./SettingsSheet";
import { IndexedAlbumsSheet } from "./IndexedAlbumsSheet";
import { useIndexedAlbums } from "./useIndexedAlbums";
import { HomeLayer } from "./HomeLayer";
import { ResultsLayer } from "./ResultsLayer";
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
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const indexedAlbums = useIndexedAlbums();
  const [overscrollProgress, setOverscrollProgress] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  const phoneRectRef = useRef<HTMLDivElement>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<PhoneMode>("home");
  const bgContentRef = useRef(contentMode);
  bgContentRef.current = contentMode;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchGridRef = useRef<HTMLDivElement>(null);
  const favoritesGridRef = useRef<HTMLDivElement>(null);


  const { isItemBlurred, nsfwPendingItem, setNsfwPendingItem, revealOne, revealAll, revealSafe } = useNsfwReveal();
  const { toggleSelected } = useSelectionTray(selectedItems, setSelectedItems);

  const sc = useSearchController({ dispatch, scrollContainerRef, topBarInputRef, modeRef, bgContentRef, modeState, modeTransition });

  const { detailItem, setDetailItem, openDetail, closeDetail, handleToggleFavorite, handleToggleSafety, searchSameDate } = usePhoneDetail({
    isItemBlurred, onSelectCandidate, modeRef, dispatch,
    setQuery: sc.setQuery, runSearch: sc.runSearch, setErrorMessage: sc.setErrorMessage, setNsfwPendingItem, revealSafe,
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
        longPressTriggeredRef.current = true; longPressTimerRef.current = null; openDetail(item);
      }, LONG_PRESS_MS);
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
    let prevScrollTop = 0;
    const handleScroll = () => {
      if (modeRef.current !== "compose") return;
      const st = el.scrollTop;
      if (bgContentRef.current === "results") {
        if (st > HIDE_COMPOSE_SCROLL_THRESHOLD) sc.setShowComposePanel(false);
        else if (st <= 0) sc.setShowComposePanel(true);
      } else {
        if (st > prevScrollTop) { dispatch({ type: "COMPOSE_DISMISS" }); topBarInputRef.current?.blur(); }
      }
      prevScrollTop = st;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode, dispatch, sc.setShowComposePanel]);

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
    setDetailItem(null);
    await sc.runSimilarById(item.id);
  }, [setDetailItem, sc.runSimilarById]);

  const sendSelection = useCallback((item?: RecallMediaItem) => {
    const next = item && !selectedItems.some((c) => c.id === item.id) ? [...selectedItems, item] : selectedItems;
    setSelectedItems(next);
  }, [selectedItems]);

  const handleConfirmAnswer = useCallback((id: string) => {
    onConfirmAnswer?.(id);
    sc.setQuery(""); sc.setSubmittedQuery(""); sc.setResults([]); setSelectedItems([]); sc.setShowHistory(false);
    dispatch({ type: "SEARCH_CLEAR" }); topBarInputRef.current?.blur();
  }, [onConfirmAnswer, dispatch, sc.setQuery, sc.setSubmittedQuery, sc.setResults, sc.setShowHistory]);

  const isSearching = sc.isAutoSearchPending || (sc.isLoading && mode === "compose");

  const renderSearchBar = (className?: string, clearLabel = "Clear search") => (
    <PhoneSearchBar ref={topBarInputRef} value={sc.query} className={className} clearLabel={clearLabel}
      showHistory={sc.showHistory} isSearching={isSearching}
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
      onKeyDown={(event) => {
        if (event.key === "Escape" && modeRef.current === "compose") { sc.closeComposeMode(); return; }
        if (event.key === "Escape" && mode !== "home") {
          sc.abortActiveSearch(); sc.setQuery(""); sc.setSubmittedQuery(""); sc.setShowHistory(false); sc.setHistory(readSearchHistory());
          dispatch({ type: "SEARCH_CLEAR" }); topBarInputRef.current?.blur();
        }
      }}
    >
      {mode === "results" && sc.hasMore ? (
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
              refinements={sc.refinements}
              loadMore={() => void sc.loadMore()}
              onRunRefinement={(refinement) => { sc.setQuery(refinement); void sc.runSearch(refinement); }} />
          </>
        </ScrollArea>

        <AnimatePresence initial={false}>
          {mode === "detail" && detailItem && (
            isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
              <VideoDetailView key={detailItem.id} item={detailItem} onBack={closeDetail} onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)} onConfirmAnswer={handleConfirmAnswer}
                onSendSelection={sendSelection} onToggleFavorite={handleToggleFavorite} onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem} layoutId={mediaLayoutId(detailItem.id)} />
            ) : (
              <ImageDetailView key={detailItem.id} item={detailItem} onBack={closeDetail} onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)} onConfirmAnswer={handleConfirmAnswer}
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
        <AnimatePresence initial={false}>
          {settingsOpen && (
            <SettingsSheet
              key="settings-sheet"
              onClose={() => setSettingsOpen(false)}
              indexedAlbumCount={indexedAlbums.count}
              indexedAlbumTotal={indexedAlbums.total}
              gridColumns={gridColumns}
              onOpenIndexedAlbums={() => setAlbumsOpen(true)}
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
      </MotionConfig>
    </div>
    </GridHandlersContext.Provider>
  );
}
