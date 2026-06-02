import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MOTION_EASE } from "../../phoneUtils";
import { AboutSheet } from "../sheets/AboutSheet";
import { HiddenDialog } from "../detail/HiddenDialog";
import { ImageDetailView } from "../detail/ImageDetailView";
import { SelectionTray } from "../grid/SelectionTray";
import { VideoDetailView } from "../detail/VideoDetailView";
import { PhoneSearchBar } from "../search/SearchCommandLayer";
import { PhoneSearchShell } from "./PhoneSearchShell";
import { PhoneHomeHeader } from "../search/PhoneHomeHeader";
import { SettingsSheet } from "../settings/SettingsSheet";
import { IndexedAlbumsSheet } from "../sheets/IndexedAlbumsSheet";
import { HomeLayer } from "./HomeLayer";
import { ResultsLayer } from "./ResultsLayer";
import { LongPressHint } from "../grid/LongPressHint";
import { GridHandlersContext } from "../grid/GridHandlersContext";
import { usePhoneController, type PhoneControllerProps } from "../../hooks/usePhoneController";

export function PhoneViewportFrame(props: PhoneControllerProps) {
  const ctrl = usePhoneController(props);
  const { mode, contentMode, modeTransition, dispatch } = ctrl;
  const { sc } = ctrl;

  const renderSearchBar = (className?: string, clearLabel = "Clear search") => {
    const isHomeContext = contentMode === "home";
    const pulseClass = isHomeContext && ctrl.showSearchPulse ? " search-bar--pulse" : "";
    const mergedClass = `${className ?? ""}${pulseClass}`.trim() || undefined;
    return (
      <PhoneSearchBar ref={ctrl.topBarInputRef} value={sc.query} className={mergedClass} clearLabel={clearLabel}
        placeholder={isHomeContext && !sc.query ? "People, places, moments…" : undefined}
        showHistory={sc.showHistory} showHistoryIcon={ctrl.showHistoryIcon} isSearching={ctrl.isSearching}
        dateBrowseLabel={mode === "results" ? sc.dateBrowseContext?.label : null}
        similarThumbnailUrl={mode === "results" && sc.similarSourceItem
          ? (sc.similarSourceItem.links?.thumbnail ?? null)
          : undefined}
        onSimilarChipTap={ctrl.handleSimilarChipTap}
        onToggleHistory={sc.handleSearchHistoryToggle} onFocus={sc.handleSearchFocus}
        onChange={sc.handleSearchChange} onSubmit={sc.handleSearchSubmit} onClear={sc.handleSearchClear} />
    );
  };

  const { detail } = ctrl;

  return (
    <GridHandlersContext.Provider value={ctrl.gridContext}>
    <div ref={ctrl.phoneRectRef}
      className={`phone-rect${contentMode === "home" ? " phone-rect--home" : ""}${ctrl.showSelectionTray ? " phone-rect--has-selection" : ""}`}
      style={ctrl.gridDensityStyle} data-reduced-motion={ctrl.prefersReducedMotion ? "true" : undefined}
      aria-label="Phone interface viewport"
      tabIndex={0}
      onKeyDown={(event) => {
        if (mode === "detail") {
          if (event.key === "ArrowLeft") { event.preventDefault(); ctrl.navigateDetail(-1); return; }
          if (event.key === "ArrowRight") { event.preventDefault(); ctrl.navigateDetail(1); return; }
          if (event.key === "Escape") { event.preventDefault(); ctrl.closeDetailFromChrome(); return; }
        }
        if (event.key === "Escape" && mode === "compose") { sc.closeComposeMode(); return; }
        if (event.key === "Escape" && mode !== "home") sc.resetSearch();
      }}
    >
      {mode === "results" && sc.hasMore ? (
        <div className={`pull-indicator${ctrl.overscrollProgress > 0 ? " pull-indicator--visible" : ""}${ctrl.overscrollProgress >= 1 ? " pull-indicator--ready" : ""}${ctrl.pullDismissing ? " pull-indicator--dismissing" : ""}`} aria-hidden>
          <svg className="pull-indicator-ring" viewBox="0 0 20 20">
            <circle className="pull-indicator-track" cx="10" cy="10" r="8" />
            <circle className="pull-indicator-fill" cx="10" cy="10" r="8" style={{ strokeDashoffset: 50.3 * (1 - ctrl.overscrollProgress) }} />
          </svg>
          <span>{ctrl.overscrollProgress >= 1 ? "Release!" : "More results"}</span>
        </div>
      ) : null}

      <MotionConfig reducedMotion="user">
      <LayoutGroup id="phone-ui">

        <AnimatePresence initial={false}>
          {contentMode === "home" && ctrl.isAtScrollTop && (
            <motion.div key="home-header"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              style={{ overflow: "hidden" }}>
              <PhoneHomeHeader onExit={ctrl.onExit} onOpenSettings={() => ctrl.setSettingsOpen(true)} />
            </motion.div>
          )}
        </AnimatePresence>

        <PhoneSearchShell
          mode={mode} query={sc.query}
          showHistory={sc.showHistory} activeHistory={sc.activeHistory}
          composeSuggestions={sc.composeSuggestions} visibleHistory={sc.visibleHistory}
          isSearching={ctrl.isSearching} showComposePanel={sc.showComposePanel}
          onAssistSearch={sc.handleAssistSearch} onClearHistory={sc.clearHistory}
          onRemoveHistoryItem={sc.removeHistoryItem} renderSearchBar={renderSearchBar}
        />

        <ScrollArea className="phone-rect-content" viewportRef={ctrl.scrollContainerRef} viewportClassName="phone-rect-viewport"
          onPointerDownCapture={mode === "compose" && contentMode !== "home" ? () => dispatch({ type: "COMPOSE_DISMISS" }) : undefined}>
          <>
            <HomeLayer visible={contentMode === "home"} modeTransition={modeTransition}
              feed={ctrl.homeFeed} items={ctrl.activeHomeItems} homeGridRef={ctrl.homeGridRef}
              isLoading={ctrl.isLoadingHomeFeed} isLoadingMore={ctrl.isLoadingMoreRecents}
              onFeedChange={ctrl.handleHomeFeedChange} />
            <ResultsLayer visible={contentMode === "results"} mode={mode} contentMode={contentMode}
              isLoading={sc.isLoading} isLoadingMore={sc.isLoadingMore} modeTransition={modeTransition}
              results={sc.results} searchGridRef={ctrl.searchGridRef}
              submittedQuery={sc.submittedQuery} errorMessage={sc.errorMessage} hasMore={sc.hasMore}
              isDateBrowse={!!sc.dateBrowseContext}
              refinements={sc.refinements}
              loadMore={() => void sc.loadMore()}
              onRunRefinement={sc.handleAssistSearch} />
          </>
        </ScrollArea>

        <AnimatePresence initial={false}>
          {mode === "detail" && detail.detailItem && (
            <motion.div key="detail-backdrop" className="detail-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: MOTION_EASE.gentle }} aria-hidden />
          )}
        </AnimatePresence>

        <AnimatePresence initial={false} custom={mode === "detail" ? ctrl.detailNavDirection : 0}>
          {mode === "detail" && detail.detailItem && (
            ctrl.isVideo(detail.detailItem) && ctrl.resolvedMediaUrl(detail.detailItem) ? (
              <VideoDetailView key={detail.detailItem.id} item={detail.detailItem}
                onBack={ctrl.closeDetailFromChrome} onSearchSameDate={ctrl.searchSameDateFromDetail}
                onRunSimilarSearch={(item) => void ctrl.runSimilarSearch(item)}
                onConfirmAnswer={ctrl.handleConfirmAnswer} onSendSelection={ctrl.sendSelection}
                onToggleFavorite={detail.handleToggleFavorite} onToggleSafety={detail.handleToggleSafety}
                onOpenAbout={detail.setAboutSheetItem} onNavigate={ctrl.navigateDetail}
                canNavigatePrevious={ctrl.canNavigateDetailPrevious} canNavigateNext={ctrl.canNavigateDetailNext}
                isSensitiveHidden={ctrl.gridContext.isItemBlurred(detail.detailItem)} onRevealSensitive={ctrl.handleRevealDetailSensitive}
                previousPreview={ctrl.previousDetailPreview} nextPreview={ctrl.nextDetailPreview}
                navigationDirection={ctrl.detailNavDirection}
                layoutId={ctrl.mediaLayoutId(detail.detailItem.id)} />
            ) : (
              <ImageDetailView key={detail.detailItem.id} item={detail.detailItem}
                onBack={ctrl.closeDetailFromChrome} onSearchSameDate={ctrl.searchSameDateFromDetail}
                onRunSimilarSearch={(item) => void ctrl.runSimilarSearch(item)}
                onConfirmAnswer={ctrl.handleConfirmAnswer} onSendSelection={ctrl.sendSelection}
                onToggleFavorite={detail.handleToggleFavorite} onToggleSafety={detail.handleToggleSafety}
                onOpenAbout={detail.setAboutSheetItem} onNavigate={ctrl.navigateDetail}
                canNavigatePrevious={ctrl.canNavigateDetailPrevious} canNavigateNext={ctrl.canNavigateDetailNext}
                isSensitiveHidden={ctrl.gridContext.isItemBlurred(detail.detailItem)} onRevealSensitive={ctrl.handleRevealDetailSensitive}
                previousPreview={ctrl.previousDetailPreview} nextPreview={ctrl.nextDetailPreview}
                navigationDirection={ctrl.detailNavDirection}
                layoutId={ctrl.mediaLayoutId(detail.detailItem.id)} />
            )
          )}
        </AnimatePresence>

      </LayoutGroup>
      </MotionConfig>

      {ctrl.hiddenPendingItem && (
        <HiddenDialog item={ctrl.hiddenPendingItem} onKeepHidden={() => ctrl.setHiddenPendingItem(null)}
          onViewItem={ctrl.handleViewHiddenItem} onRevealAll={ctrl.revealAll} />
      )}

      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>
          {detail.aboutSheetItem && <AboutSheet item={detail.aboutSheetItem} onClose={() => detail.setAboutSheetItem(null)} />}
        </AnimatePresence>
      </MotionConfig>

      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>
          {ctrl.settingsOpen && (
            <SettingsSheet key="settings-sheet"
              onClose={() => ctrl.setSettingsOpen(false)}
              indexedAlbumCount={ctrl.indexedAlbums.count}
              indexedAlbumTotal={ctrl.indexedAlbums.total}
              gridColumns={ctrl.gridContext.gridColumns}
              onOpenIndexedAlbums={() => ctrl.setAlbumsOpen(true)}
              onRevealAll={ctrl.revealAll}
              escapeDisabled={ctrl.albumsOpen}
            />
          )}
          {ctrl.albumsOpen && (
            <IndexedAlbumsSheet key="albums-sheet"
              initialSelectedIds={ctrl.indexedAlbums.selectedIds}
              onCancel={() => ctrl.setAlbumsOpen(false)}
              onSave={(ids) => { ctrl.indexedAlbums.save(ids); ctrl.setAlbumsOpen(false); }}
            />
          )}
        </AnimatePresence>
      </MotionConfig>

      <MotionConfig reducedMotion="user">
        {ctrl.showSelectionTray && (
          <SelectionTray selectedItems={ctrl.gridContext.selectedItems} toggleSelected={ctrl.gridContext.toggleSelected}
            onConfirmAnswer={ctrl.handleConfirmAnswer} onClearSelection={() => ctrl.gridSelection.setSelectedItems([])} />
        )}
        <LongPressHint visible={ctrl.gridSelection.showLongPressHint} onDismiss={ctrl.gridSelection.dismissLongPressHint} />
      </MotionConfig>
    </div>
    </GridHandlersContext.Provider>
  );
}
