import React, { useCallback, useState } from "react";
import { motion } from "motion/react";
import { EyeOffIcon, PlayIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isAnimatedImage, isVideo, resolvedAnimatedThumbnailUrl, resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import {
  aspectRatioFromDimensions,
  durationLabel,
  itemTitle,
  mediaAspectRatio,
  mediaLayoutId,
  PHONE_MOTION,
  MOTION_EASE,
  MIN_GRID_COLUMNS,
  MAX_GRID_COLUMNS,
} from "./phoneUtils";
import { useGridHandlers } from "./GridHandlersContext";

interface ThumbCellProps {
  result: RecallMediaItem;
  isBlurred: boolean;
  selected: boolean;
  selectionIndex: number;
  naturalAspectRatio: boolean;
  onPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
}

const ThumbCell = React.memo(function ThumbCell({
  result, isBlurred, selected, selectionIndex, naturalAspectRatio,
  onPointerDown, onPointerUp, onPointerMove, onPointerCancel, toggleSelected,
}: ThumbCellProps) {
  const [staticLoaded, setStaticLoaded] = useState(false);
  const [measuredAspectRatio, setMeasuredAspectRatio] = useState<string | null>(null);
  const thumb = resolvedThumbnailUrl(result) ?? result.links?.thumbnail ?? result.links?.media;
  const animatedThumb = resolvedAnimatedThumbnailUrl(result);
  const video = isVideo(result);
  const animated = isAnimatedImage(result);
  const metadataAspectRatio = mediaAspectRatio(result);
  const naturalAspectStyle = naturalAspectRatio
    ? ({ "--phone-thumb-aspect-ratio": metadataAspectRatio ?? measuredAspectRatio ?? "1 / 1" } as React.CSSProperties)
    : undefined;

  const handleStaticThumbLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    setStaticLoaded(true);
    const image = event.currentTarget;
    setMeasuredAspectRatio(aspectRatioFromDimensions(image.naturalWidth, image.naturalHeight));
  }, []);

  return (
    <motion.div
      className="phone-thumb-motion"
      layoutId={mediaLayoutId(result.id)}
      style={naturalAspectStyle}
      transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
    >
      <Button
        className={`thumb h-auto ${selected ? "thumb--selected" : ""}`}
        type="button"
        variant="ghost"
        data-phone-grid-item={result.id}
        onPointerDown={(e) => onPointerDown(e, result)}
        onPointerUp={(e) => onPointerUp(e, result)}
        onPointerMove={onPointerMove}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSelected(result); } }}
        aria-label={isBlurred ? "Sensitive content — tap to review" : `${selected ? "Deselect" : "Select"} ${itemTitle(result)}`}
        aria-pressed={isBlurred ? undefined : selected}
      >
        {thumb ? (
          <div className={`thumb-img-wrap${isBlurred ? " thumb-img-wrap--nsfw" : ""}`}>
            <img src={thumb} alt={result.metadata.search?.description ?? ""} loading="lazy" decoding="async" onLoad={handleStaticThumbLoad} />
            {!isBlurred && staticLoaded && animatedThumb ? (
              <img src={animatedThumb} alt="" aria-hidden loading="lazy" decoding="async" className="thumb-animated" onLoad={(e) => { e.currentTarget.style.opacity = "1"; }} />
            ) : null}
            {isBlurred ? (
              <div className="nsfw-thumb-overlay" aria-hidden>
                <EyeOffIcon />
              </div>
            ) : null}
          </div>
        ) : <span className="thumb-fallback" />}
        {!isBlurred && video ? (
          <Badge variant="secondary" className="video-badge">
            <PlayIcon />
            {durationLabel(result.metadata.asset?.duration_seconds) ?? "video"}
          </Badge>
        ) : !isBlurred && animated ? (
          <Badge variant="secondary" className="video-badge video-badge--gif">GIF</Badge>
        ) : null}
        {!isBlurred && selected ? (
          <Badge variant="default" className="selected-num" aria-hidden>{selectionIndex + 1}</Badge>
        ) : null}
      </Button>
    </motion.div>
  );
});

export type GridGestureHandlers = Pick<
  React.HTMLAttributes<HTMLElement>,
  "onPointerDownCapture" | "onPointerMoveCapture" | "onPointerUpCapture" | "onPointerCancelCapture"
>;

export interface MediaGridProps {
  items: RecallMediaItem[];
  gridRef: React.Ref<HTMLDivElement>;
  scope: string;
  ariaLabel: string;
  className: string;
  isLoading?: boolean;
  loadingCount?: number;
  loadingKeyPrefix?: string;
  emptyContent?: React.ReactNode;
  trailingLoadingCount?: number;
  trailingLoadingKeyPrefix?: string;
}

export function MediaGrid({
  items,
  gridRef,
  scope,
  ariaLabel,
  className,
  isLoading = false,
  loadingCount = 0,
  loadingKeyPrefix = "loading",
  emptyContent = null,
  trailingLoadingCount = 0,
  trailingLoadingKeyPrefix = "more",
}: MediaGridProps) {
  const { selectedItems, isItemBlurred, onPointerDown, onPointerUp, onPointerMove, onPointerCancel, toggleSelected, naturalAspectRatio } = useGridHandlers();
  const showInitialLoading = isLoading && items.length === 0;

  return (
    <div ref={gridRef} className={className} data-phone-grid-scope={scope} role="group" aria-label={ariaLabel}>
      {showInitialLoading ? (
        Array.from({ length: loadingCount }, (_, index) => (
          <Skeleton key={index} className="thumb-skeleton" data-phone-grid-item={`${loadingKeyPrefix}-${index}`} aria-hidden="true" />
        ))
      ) : items.length === 0 ? (
        emptyContent
      ) : items.map((result) => {
        const selectionIndex = selectedItems.findIndex((item) => item.id === result.id);
        return (
          <ThumbCell
            key={result.id}
            result={result}
            isBlurred={isItemBlurred(result)}
            selected={selectionIndex >= 0}
            selectionIndex={selectionIndex}
            naturalAspectRatio={naturalAspectRatio}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerMove={onPointerMove}
            onPointerCancel={onPointerCancel}
            toggleSelected={toggleSelected}
          />
        );
      })}
      {trailingLoadingCount > 0 ? (
        Array.from({ length: trailingLoadingCount }, (_, index) => (
          <Skeleton key={`${trailingLoadingKeyPrefix}-${index}`} className="thumb-skeleton" data-phone-grid-item={`${trailingLoadingKeyPrefix}-${index}`} aria-hidden="true" />
        ))
      ) : null}
    </div>
  );
}

interface GridZoomControlsProps {
  columns: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function GridZoomControls({ columns, onZoomIn, onZoomOut }: GridZoomControlsProps) {
  return (
    <div className="phone-grid-zoom-controls" role="group" aria-label={`Grid zoom, ${columns} ${columns === 1 ? "column" : "columns"}`}>
      <Button
        className="phone-grid-zoom-btn"
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onZoomOut}
        disabled={columns >= MAX_GRID_COLUMNS}
        aria-label="Zoom out to show more thumbnails"
        title="Show more thumbnails"
      >
        <ZoomOutIcon />
      </Button>
      <Button
        className="phone-grid-zoom-btn"
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onZoomIn}
        disabled={columns <= MIN_GRID_COLUMNS}
        aria-label="Zoom in to show fewer thumbnails"
        title="Show fewer thumbnails"
      >
        <ZoomInIcon />
      </Button>
    </div>
  );
}