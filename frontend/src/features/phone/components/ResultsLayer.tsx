import { motion } from "motion/react";
import { ResultsSection } from "./ResultsSection";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { PhoneBgContent } from "../phoneReducer";
import { screenMotionVariants, type ModeTransition } from "./phoneUtils";

interface ResultsLayerProps {
  visible: boolean;
  mode: string;
  contentMode: PhoneBgContent;
  isLoading: boolean;
  isLoadingMore: boolean;
  modeTransition: ModeTransition;
  results: RecallMediaItem[];
  searchGridRef: React.RefObject<HTMLDivElement | null>;
  submittedQuery: string;
  errorMessage: string | null;
  hasMore: boolean;
  refinements: string[];
  loadMore: () => void;
  onRunRefinement: (refinement: string) => void;
}

export function ResultsLayer({ visible, mode, contentMode, isLoading, isLoadingMore, modeTransition,
  results, searchGridRef, submittedQuery, errorMessage, hasMore, refinements, loadMore, onRunRefinement }: ResultsLayerProps) {
  if (!visible) return null;
  return (
    <motion.div key="screen-search"
      className={`phone-screen phone-screen--search${mode === "compose" ? " phone-screen--dimmed" : ""}${isLoading && mode === "results" && contentMode === "results" ? " phone-screen--loading" : ""}`}
      custom={modeTransition} variants={screenMotionVariants} initial="enter" animate="center" exit="exit">
      <ResultsSection results={results} searchGridRef={searchGridRef}
        isLoading={isLoading} isLoadingMore={isLoadingMore}
        contentMode={contentMode} submittedQuery={submittedQuery} errorMessage={errorMessage} hasMore={hasMore}
        refinements={refinements} onLoadMore={loadMore} onRunRefinement={onRunRefinement} />
    </motion.div>
  );
}
