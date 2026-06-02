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
import type { PhoneBgContent } from "../../phoneReducer";
import { SEARCH_BATCH_SIZE } from "../../phoneUtils";
import { MediaGrid, GridZoomControls } from "../grid/MediaGrid";
import { useGridHandlers } from "../grid/GridHandlersContext";

interface ResultsSectionProps {
  results: RecallMediaItem[];
  searchGridRef: React.Ref<HTMLDivElement>;
  isLoading: boolean;
  isLoadingMore: boolean;
  contentMode: PhoneBgContent;
  submittedQuery: string;
  errorMessage: string | null;
  hasMore: boolean;
  isDateBrowse: boolean;
  refinements: string[];
  onLoadMore: () => void;
  onRunRefinement: (refinement: string) => void;
}

export function ResultsSection({
  results,
  searchGridRef,
  isLoading,
  isLoadingMore,
  contentMode,
  errorMessage,
  hasMore,
  isDateBrowse,
  refinements,
  onLoadMore,
  onRunRefinement,
}: ResultsSectionProps) {
  const { pinchHandlers, gridColumns, zoomGridIn, zoomGridOut, mediaGridClassName } = useGridHandlers();
  const emptyContent = contentMode === "results" ? (
    <Empty className="search-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ImageOffIcon />
        </EmptyMedia>
        <EmptyTitle>{isDateBrowse ? "No items found" : "No results"}</EmptyTitle>
        <EmptyDescription>{isDateBrowse ? "No items found for this date." : "Try another description."}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : null;

  return (
    <div className="grid-wrap phone-media-grid-zone" data-testid="phone-search-grid-zone" {...pinchHandlers}>
      <div className="phone-grid-toolbar phone-grid-toolbar--controls-only">
        <GridZoomControls columns={gridColumns} onZoomIn={zoomGridIn} onZoomOut={zoomGridOut} />
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
        className={mediaGridClassName}
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
            {!isDateBrowse && refinements.length > 0 ? (
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
