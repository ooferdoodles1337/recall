import { motion } from "motion/react";
import { ResultsSection } from "./ResultsSection";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { PhoneBgContent } from "../phoneReducer";
import { screenMotionVariants, type ModeTransition } from "./phoneUtils";
import type { GridGestureHandlers } from "./MediaGrid";

interface ResultsLayerProps {
  visible: boolean;
  mode: string;
  contentMode: PhoneBgContent;
  isLoading: boolean;
  isLoadingMore: boolean;
  modeTransition: ModeTransition;
  results: RecallMediaItem[];
  searchGridRef: React.RefObject<HTMLDivElement | null>;
  mediaGridClassName: string;
  pinchHandlers: GridGestureHandlers;
  gridColumns: number;
  submittedQuery: string;
  errorMessage: string | null;
  hasMore: boolean;
  refinements: string[];
  usesNaturalAspectGrid: boolean;
  selectedItems: RecallMediaItem[];
  isItemBlurred: (item: RecallMediaItem) => boolean;
  zoomGridIn: () => void;
  zoomGridOut: () => void;
  handleItemPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  handleItemPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  handleItemPointerMove: (e: React.PointerEvent) => void;
  handleItemPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
  loadMore: () => void;
  onRunRefinement: (refinement: string) => void;
}

export function ResultsLayer({ visible, mode, contentMode, isLoading, isLoadingMore, modeTransition,
  results, searchGridRef, mediaGridClassName, pinchHandlers, gridColumns, submittedQuery,
  errorMessage, hasMore, refinements, usesNaturalAspectGrid, selectedItems, isItemBlurred,
  zoomGridIn, zoomGridOut, handleItemPointerDown, handleItemPointerUp, handleItemPointerMove,
  handleItemPointerCancel, toggleSelected, loadMore, onRunRefinement }: ResultsLayerProps) {
  if (!visible) return null;
  return (
    <motion.div key="screen-search"
      className={`phone-screen phone-screen--search${mode === "compose" ? " phone-screen--dimmed" : ""}${isLoading && mode === "results" && contentMode === "results" ? " phone-screen--loading" : ""}`}
      custom={modeTransition} variants={screenMotionVariants} initial="enter" animate="center" exit="exit">
      <ResultsSection results={results} searchGridRef={searchGridRef} gridClassName={mediaGridClassName}
        gridGestureHandlers={pinchHandlers} gridColumns={gridColumns} isLoading={isLoading} isLoadingMore={isLoadingMore}
        contentMode={contentMode} submittedQuery={submittedQuery} errorMessage={errorMessage} hasMore={hasMore}
        refinements={refinements} naturalAspectRatio={usesNaturalAspectGrid}
        selectedItems={selectedItems} isItemBlurred={isItemBlurred}
        onZoomIn={zoomGridIn} onZoomOut={zoomGridOut}
        onItemPointerDown={handleItemPointerDown} onItemPointerUp={handleItemPointerUp}
        onItemPointerMove={handleItemPointerMove} onItemPointerCancel={handleItemPointerCancel}
        toggleSelected={toggleSelected} onLoadMore={loadMore} onRunRefinement={onRunRefinement} />
    </motion.div>
  );
}