import { ImageOffIcon, InfoIcon, SparklesIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { PhoneBgContent } from "../phoneReducer";
import { SEARCH_BATCH_SIZE } from "./phoneUtils";
import { MediaGrid, GridZoomControls, type GridGestureHandlers } from "./MediaGrid";

interface ResultsSectionProps {
  results: RecallMediaItem[];
  searchGridRef: React.Ref<HTMLDivElement>;
  gridClassName: string;
  gridGestureHandlers: GridGestureHandlers;
  gridColumns: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  contentMode: PhoneBgContent;
  submittedQuery: string;
  errorMessage: string | null;
  hasMore: boolean;
  refinements: string[];
  naturalAspectRatio: boolean;
  selectedItems: RecallMediaItem[];
  isItemBlurred: (item: RecallMediaItem) => boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onItemPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onItemPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onItemPointerMove: (e: React.PointerEvent) => void;
  onItemPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
  onLoadMore: () => void;
  onRunRefinement: (refinement: string) => void;
}

export function ResultsSection({
  results,
  searchGridRef,
  gridClassName,
  gridGestureHandlers,
  gridColumns,
  isLoading,
  isLoadingMore,
  contentMode,
  submittedQuery,
  errorMessage,
  hasMore,
  refinements,
  naturalAspectRatio,
  selectedItems,
  isItemBlurred,
  onZoomIn,
  onZoomOut,
  onItemPointerDown,
  onItemPointerUp,
  onItemPointerMove,
  onItemPointerCancel,
  toggleSelected,
  onLoadMore,
  onRunRefinement,
}: ResultsSectionProps) {
  const emptyContent = contentMode === "results" ? (
    <Empty className="search-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ImageOffIcon />
        </EmptyMedia>
        <EmptyTitle>No results</EmptyTitle>
        <EmptyDescription>Try another description.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : null;

  return (
    <div className="grid-wrap phone-media-grid-zone" data-testid="phone-search-grid-zone" {...gridGestureHandlers}>
      <div className={`phone-grid-toolbar${submittedQuery && contentMode === "results" ? "" : " phone-grid-toolbar--controls-only"}`}>
        {submittedQuery && contentMode === "results" ? (
          <div className="result-context">
            <strong>{submittedQuery}</strong>
          </div>
        ) : null}
        <GridZoomControls columns={gridColumns} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />
      </div>
      {errorMessage ? (
        <Alert variant="destructive" className="search-notice">
          <InfoIcon />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <MediaGrid
        items={results}
        gridRef={searchGridRef}
        scope="search"
        ariaLabel="Search results"
        className={gridClassName}
        naturalAspectRatio={naturalAspectRatio}
        selectedItems={selectedItems}
        isItemBlurred={isItemBlurred}
        onPointerDown={onItemPointerDown}
        onPointerUp={onItemPointerUp}
        onPointerMove={onItemPointerMove}
        onPointerCancel={onItemPointerCancel}
        toggleSelected={toggleSelected}
        isLoading={isLoading}
        loadingCount={SEARCH_BATCH_SIZE}
        loadingKeyPrefix="loading"
        emptyContent={emptyContent}
        trailingLoadingCount={isLoadingMore ? 9 : 0}
        trailingLoadingKeyPrefix="more"
      />

      {contentMode === "results" && !isLoading ? (
        <Card className="results-footer-card" size="sm">
          <CardContent className="results-footer-content p-0">
            {hasMore ? (
              <Button
                className="footer-action h-auto"
                type="button"
                variant="outline"
                disabled={isLoadingMore}
                onClick={onLoadMore}
              >
                <SparklesIcon data-icon="inline-start" />
                {isLoadingMore ? "Loading…" : "Show more results"}
              </Button>
            ) : null}
            {hasMore && refinements.length > 0 ? <Separator className="results-footer-separator" /> : null}
            {refinements.length > 0 ? (
              <div className="refinement-row">
                <span>Did you mean</span>
                {refinements.map((refinement) => (
                  <Button
                    key={refinement}
                    className="refinement-chip h-auto"
                    type="button"
                    variant="outline"
                    onClick={() => onRunRefinement(refinement)}
                  >
                    {refinement}
                  </Button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}