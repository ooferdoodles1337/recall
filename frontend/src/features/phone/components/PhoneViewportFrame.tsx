import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  EyeOffIcon,
  ImageOffIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  StarIcon,
  UserIcon,
  SendIcon,
  SparklesIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecallMediaItem, RecallSearchResult } from "@/shared/types/recall";
import { isAnimatedImage, isVideo, resolvedAnimatedThumbnailUrl, resolvedMediaUrl, resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import { AboutSheet } from "./AboutSheet";
import {
  listFavoriteItems,
  listRecentItems,
  patchCatalogItem,
  searchSemantic,
  searchSimilarById,
  searchText,
  suggestSearches,
} from "../api/searchApi";
import {
  initialPhoneModeState,
  phoneModeReducer,
  type ModeTransition,
  type PhoneBgContent,
  type PhoneScreen,
} from "../phoneReducer";
import { PhoneSearchBar, SearchAssistPanel } from "./SearchCommandLayer";

interface PhoneViewportFrameProps {
  currentTarget?: RecallMediaItem;
  onSelectCandidate?: (id: string) => void;
  onConfirmAnswer?: (id: string) => void;
  onExit?: () => void;
}

type PhoneMode = PhoneScreen;
type GridColumns = 1 | 2 | 3 | 4 | 5 | 6;
type GridPoint = { x: number; y: number };
type GridItemSnapshot = Map<string, DOMRect>;
type PinchGesture = {
  startColumns: GridColumns;
  startDistance: number;
  midpoint: GridPoint;
};
// MotionDirection, ModeTransitionReason, ModeTransition are imported from phoneReducer.

const SEARCH_BATCH_SIZE = 50;
const FAVORITES_COUNT = 34;
const SEARCH_HISTORY_KEY = "recall.searchHistory.v1";
const GRID_COLUMNS_STORAGE_KEY = "recall.phoneGridColumns.v1";
const OVERSCROLL_THRESHOLD = 80;
const GRID_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const satisfies readonly GridColumns[];
const DEFAULT_GRID_COLUMNS: GridColumns = 3;
const MIN_GRID_COLUMNS = GRID_COLUMN_OPTIONS[0];
const MAX_GRID_COLUMNS = GRID_COLUMN_OPTIONS[GRID_COLUMN_OPTIONS.length - 1];
const GRID_GAP_BY_COLUMNS: Record<GridColumns, string> = {
  1: "12px",
  2: "8px",
  3: "6px",
  4: "4px",
  5: "3px",
  6: "2px",
};
const GRID_RADIUS_BY_COLUMNS: Record<GridColumns, string> = {
  1: "16px",
  2: "14px",
  3: "12px",
  4: "10px",
  5: "8px",
  6: "6px",
};
const PHONE_MOTION = {
  screenMs: 220,
  detailMs: 300,
  exitMs: 180,
  standard: "cubic-bezier(0.22, 1, 0.36, 1)",
  gentle: "cubic-bezier(0.16, 1, 0.3, 1)",
};
const MOTION_EASE = {
  standard: [0.22, 1, 0.36, 1] as [number, number, number, number],
  gentle: [0.16, 1, 0.3, 1] as [number, number, number, number],
  exit: [0.4, 0, 1, 1] as [number, number, number, number],
};
const screenMotionVariants = {
  enter: ({ direction, reason }: ModeTransition) => ({
    opacity: 0,
    y: reason === "search-clear" || reason === "autosearch-commit" ? 0 : direction === "back" ? -10 : 14,
    scale: reason === "search-clear" || reason === "autosearch-commit" ? 1 : direction === "back" ? 1.012 : 0.988,
  }),
  center: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: PHONE_MOTION.screenMs / 1000,
      ease: MOTION_EASE.standard,
    },
  },
  exit: ({ direction, reason }: ModeTransition) => ({
    opacity: 0,
    y: reason === "search-clear" || reason === "autosearch-commit" ? 0 : direction === "back" ? 16 : -8,
    scale: reason === "search-clear" ? 0.96 : reason === "autosearch-commit" ? 1 : direction === "back" ? 0.986 : 1.01,
    transition: {
      duration: reason === "search-clear" ? 0.2 : PHONE_MOTION.exitMs / 1000,
      ease: reason === "search-clear" ? ([0.4, 0, 0.2, 1] as [number, number, number, number]) : MOTION_EASE.exit,
    },
  }),
};
const detailBackdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: MOTION_EASE.standard } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: MOTION_EASE.exit } },
};


function isItemNsfw(item: RecallMediaItem) {
  return item.metadata.safety?.state === "nsfw";
}

function makeMockItem(seed: string, q?: string): RecallMediaItem {
  const thumb = `https://picsum.photos/seed/${encodeURIComponent(seed)}/440/330`;
  const media = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/900`;
  return {
    id: seed,
    metadata: {
      asset: {
        filename: `${seed}.jpg`,
        media_type: "image",
        mime_type: "image/jpeg",
      },
      search: { description: q ?? "Sample library item" },
    },
    links: { media, thumbnail: thumb },
  };
}

function readSearchHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeSearchHistory(nextHistory: string[]) {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory.slice(0, 8)));
}

function isGridColumns(value: number): value is GridColumns {
  return GRID_COLUMN_OPTIONS.includes(value as GridColumns);
}

function clampGridColumns(value: number): GridColumns {
  const rounded = Math.round(value);
  if (rounded <= MIN_GRID_COLUMNS) return MIN_GRID_COLUMNS;
  if (rounded >= MAX_GRID_COLUMNS) return MAX_GRID_COLUMNS;
  return isGridColumns(rounded) ? rounded : DEFAULT_GRID_COLUMNS;
}

function readGridColumns(): GridColumns {
  if (typeof window === "undefined") return DEFAULT_GRID_COLUMNS;

  try {
    const stored = window.localStorage.getItem(GRID_COLUMNS_STORAGE_KEY);
    if (stored === null) return DEFAULT_GRID_COLUMNS;

    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampGridColumns(parsed) : DEFAULT_GRID_COLUMNS;
  } catch {
    return DEFAULT_GRID_COLUMNS;
  }
}

function writeGridColumns(nextColumns: GridColumns) {
  try {
    window.localStorage.setItem(GRID_COLUMNS_STORAGE_KEY, String(nextColumns));
  } catch {
    // Persistence is a nice-to-have; the in-memory density still updates.
  }
}

function nearestGridColumns(value: number): GridColumns {
  return clampGridColumns(value);
}

function pointerDistance(first: GridPoint, second: GridPoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointerMidpoint(first: GridPoint, second: GridPoint): GridPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function reduceMotionEnabled() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function mediaLayoutId(itemId: string) {
  return `phone-media-${itemId}`;
}

function aspectRatioFromDimensions(width?: number, height?: number) {
  if (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return `${width} / ${height}`;
  }

  return null;
}

function mediaAspectRatio(item: RecallMediaItem) {
  return aspectRatioFromDimensions(item.metadata.asset?.width, item.metadata.asset?.height);
}

function rememberSearch(query: string) {
  const normalized = query.trim();
  if (!normalized) return;

  const nextHistory = [
    normalized,
    ...readSearchHistory().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ];
  writeSearchHistory(nextHistory);
}

function mergeResults(...groups: RecallSearchResult[][]): RecallSearchResult[] {
  const seen = new Set<string>();
  const merged: RecallSearchResult[] = [];

  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

function localSuggestions(query: string, history: string[]): string[] {
  const q = query.trim();
  if (!q) return history.slice(0, 5);

  const lower = q.toLowerCase();
  const historyMatches = history.filter((item) => item.toLowerCase().includes(lower));
  const semanticCompletions = [
    `${q} video`,
    `${q} photo`,
    `${q} meme`,
    `${q} reaction image`,
    `${q} from trip`,
  ];

  return [...historyMatches, ...semanticCompletions]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 6);
}

function itemTitle(item: RecallMediaItem) {
  return item.metadata.search?.description || item.metadata.asset?.filename || item.id;
}

function itemDateLabel(item: RecallMediaItem) {
  return item.metadata.capture?.date ?? item.metadata.capture?.year_month ?? null;
}

function durationLabel(seconds?: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function playbackTimeLabel(seconds: number) {
  return durationLabel(seconds) ?? "0:00";
}

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

const ThumbCell = React.memo(function ThumbCell({ result, isBlurred, selected, selectionIndex, naturalAspectRatio, onPointerDown, onPointerUp, onPointerMove, onPointerCancel, toggleSelected }: ThumbCellProps) {
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

type GridGestureHandlers = Pick<
  React.HTMLAttributes<HTMLElement>,
  "onPointerDownCapture" | "onPointerMoveCapture" | "onPointerUpCapture" | "onPointerCancelCapture"
>;

interface MediaGridProps {
  items: RecallMediaItem[];
  gridRef: React.Ref<HTMLDivElement>;
  scope: string;
  ariaLabel: string;
  className: string;
  naturalAspectRatio: boolean;
  selectedItems: RecallMediaItem[];
  isItemBlurred: (item: RecallMediaItem) => boolean;
  onPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
  isLoading?: boolean;
  loadingCount?: number;
  loadingKeyPrefix?: string;
  emptyContent?: React.ReactNode;
  trailingLoadingCount?: number;
  trailingLoadingKeyPrefix?: string;
}

function MediaGrid({
  items,
  gridRef,
  scope,
  ariaLabel,
  className,
  naturalAspectRatio,
  selectedItems,
  isItemBlurred,
  onPointerDown,
  onPointerUp,
  onPointerMove,
  onPointerCancel,
  toggleSelected,
  isLoading = false,
  loadingCount = 0,
  loadingKeyPrefix = "loading",
  emptyContent = null,
  trailingLoadingCount = 0,
  trailingLoadingKeyPrefix = "more",
}: MediaGridProps) {
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

interface FavoritesSectionProps {
  favoriteItems: RecallMediaItem[];
  favoritesGridRef: React.Ref<HTMLDivElement>;
  gridClassName: string;
  gridGestureHandlers: GridGestureHandlers;
  gridColumns: GridColumns;
  isLoadingFavorites: boolean;
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
}

function FavoritesSection({
  favoriteItems,
  favoritesGridRef,
  gridClassName,
  gridGestureHandlers,
  gridColumns,
  isLoadingFavorites,
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
}: FavoritesSectionProps) {
  return (
    <section className="phone-favorites-section phone-media-grid-zone" data-testid="phone-favorites-grid-zone" aria-labelledby="phone-favorites-title" {...gridGestureHandlers}>
      <div className="phone-favorites-header">
        <h2 id="phone-favorites-title" className="phone-favorites-title">Favorites</h2>
        <div className="phone-favorites-actions">
          {!isLoadingFavorites ? (
            <span className="phone-favorites-count">{favoriteItems.length} items</span>
          ) : null}
          <GridZoomControls columns={gridColumns} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />
        </div>
      </div>
      <MediaGrid
        items={favoriteItems}
        gridRef={favoritesGridRef}
        scope="favorites"
        ariaLabel="Favorite media grid"
        className={`${gridClassName} phone-favorites-grid`}
        naturalAspectRatio={naturalAspectRatio}
        selectedItems={selectedItems}
        isItemBlurred={isItemBlurred}
        onPointerDown={onItemPointerDown}
        onPointerUp={onItemPointerUp}
        onPointerMove={onItemPointerMove}
        onPointerCancel={onItemPointerCancel}
        toggleSelected={toggleSelected}
        isLoading={isLoadingFavorites}
        loadingCount={9}
        loadingKeyPrefix="favorite-skeleton"
      />
    </section>
  );
}

interface ResultsSectionProps {
  results: RecallMediaItem[];
  searchGridRef: React.Ref<HTMLDivElement>;
  gridClassName: string;
  gridGestureHandlers: GridGestureHandlers;
  gridColumns: GridColumns;
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

function ResultsSection({
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

interface NsfwDialogProps {
  item: RecallMediaItem;
  onKeepHidden: () => void;
  onRevealOne: (id: string) => void;
  onRevealAll: () => void;
  onMarkSafe: (item: RecallMediaItem) => void;
}

function NsfwDialog({ item, onKeepHidden, onRevealOne, onRevealAll, onMarkSafe }: NsfwDialogProps) {
  const mediaType = item.metadata.asset?.media_type === "video" ? "video" : "photo";
  return (
    <div className="nsfw-backdrop" role="dialog" aria-modal aria-label="Sensitive content warning" onClick={onKeepHidden}>
      <div className="nsfw-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="nsfw-sheet-header">
          <div className="nsfw-sheet-icon" aria-hidden>
            <ShieldAlertIcon />
          </div>
          <p className="nsfw-sheet-title">Sensitive Content</p>
          <p className="nsfw-sheet-body">This {mediaType} was flagged as potentially inappropriate.</p>
        </div>
        <div className="nsfw-sheet-actions">
          <button className="nsfw-sheet-btn nsfw-sheet-btn--reveal-all" type="button" onClick={onRevealAll}>
            Reveal for Session
          </button>
          <button className="nsfw-sheet-btn nsfw-sheet-btn--reveal-one" type="button" onClick={() => onRevealOne(item.id)}>
            Reveal This One
          </button>
          <button className="nsfw-sheet-btn nsfw-sheet-btn--mark-safe" type="button" onClick={() => onMarkSafe(item)}>
            Mark as Safe
          </button>
          <button className="nsfw-sheet-btn nsfw-sheet-btn--cancel" type="button" onClick={onKeepHidden}>
            Keep Hidden
          </button>
        </div>
      </div>
    </div>
  );
}

interface GridZoomControlsProps {
  columns: GridColumns;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

function GridZoomControls({ columns, onZoomIn, onZoomOut }: GridZoomControlsProps) {
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

interface VideoDetailViewProps {
  item: RecallMediaItem;
  onBack: () => void;
  onSearchSameDate: (item: RecallMediaItem) => void;
  onRunSimilarSearch: (item: RecallMediaItem) => void;
  onConfirmAnswer?: (id: string) => void;
  onSendSelection: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  layoutId?: string;
}

function VideoDetailView({
  item,
  onBack,
  onSearchSameDate,
  onRunSimilarSearch,
  onConfirmAnswer,
  onSendSelection,
  onToggleFavorite,
  onToggleSafety,
  onOpenAbout,
  layoutId,
}: VideoDetailViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoUnmutedRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.metadata.asset?.duration_seconds ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const mediaUrl = resolvedMediaUrl(item);
  const posterUrl = resolvedThumbnailUrl(item) ?? undefined;

  const clearChromeTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearChromeTimer();
    if (!isPlaying || isScrubbing) return;
    hideTimerRef.current = setTimeout(() => {
      setChromeVisible(false);
      hideTimerRef.current = null;
    }, 2400);
  }, [clearChromeTimer, isPlaying, isScrubbing]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(item.metadata.asset?.duration_seconds ?? 0);
    setIsPlaying(false);
    setIsScrubbing(false);
    setChromeVisible(true);
    setIsMuted(true);
    hasAutoUnmutedRef.current = false;
    if (videoRef.current) videoRef.current.muted = true;
    clearChromeTimer();
  }, [clearChromeTimer, item.id, item.metadata.asset?.duration_seconds]);

  useEffect(() => {
    scheduleChromeHide();
    return clearChromeTimer;
  }, [clearChromeTimer, scheduleChromeHide]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setChromeVisible(true);
    if (video.paused) {
      if (!hasAutoUnmutedRef.current) {
        hasAutoUnmutedRef.current = true;
        video.muted = false;
        setIsMuted(false);
      }
      void video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setIsMuted(next);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration)) {
      setDuration(video.duration);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || isScrubbing) return;
    setCurrentTime(video.currentTime);
  }, [isScrubbing]);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    if (!Number.isFinite(nextTime)) return;
    setCurrentTime(nextTime);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
  }, []);

  const startScrubbing = useCallback(() => {
    clearChromeTimer();
    setIsScrubbing(true);
    setChromeVisible(true);
  }, [clearChromeTimer]);

  const stopScrubbing = useCallback(() => {
    setIsScrubbing(false);
  }, []);

  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => !visible);
  }, []);

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const timelineMax = Math.max(duration, 0.01);

  if (!mediaUrl) {
    return null;
  }

  return (
    <motion.div
      className={`detail-screen detail-screen--video phone-detail-motion ${chromeVisible ? "detail-screen--chrome-visible" : "detail-screen--chrome-hidden"}${isScrubbing ? " detail-screen--scrubbing" : ""}`}
      aria-label={`${itemTitle(item)} detail view`}
      variants={detailBackdropMotion}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="detail-media-fill detail-media-fill--video phone-detail-media-motion"
        layoutId={layoutId}
        transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
      >
        <video
          ref={videoRef}
          src={mediaUrl}
          poster={posterUrl}
          muted
          playsInline
          preload="metadata"
          onClick={toggleChrome}
          onContextMenu={(e) => e.preventDefault()}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => { setIsPlaying(false); setChromeVisible(true); }}
          onEnded={() => { setIsPlaying(false); setChromeVisible(true); }}
        />
      </motion.div>

      <div className="detail-float-top video-chrome">
        <Button
          className="detail-float-btn"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeftIcon />
        </Button>
        {itemDateLabel(item) ? (
          <Badge variant="outline" className="detail-float-info">
            <span>{itemDateLabel(item)}</span>
          </Badge>
        ) : <div className="detail-float-info-spacer" />}
        <Button
          className="detail-float-btn"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onToggleFavorite(item)}
          aria-label={item.metadata.organization?.favorite ? "Remove from favorites" : "Add to favorites"}
        >
          {item.metadata.organization?.favorite ? (
            <StarIcon fill="currentColor" />
          ) : (
            <StarIcon />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="detail-float-btn"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {item.metadata.safety?.state === "nsfw" ? (
              <DropdownMenuItem onClick={() => onToggleSafety(item, "safe")}>
                <ShieldCheckIcon />
                Mark as Safe
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onToggleSafety(item, "nsfw")}>
                <ShieldAlertIcon />
                Mark as NSFW
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpenAbout(item)}>
              <InfoIcon />
              About
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="video-control-panel video-chrome" role="group" aria-label="Detail actions" onPointerMove={revealChrome}>
        <div className="video-action-row">
          <Button
            className="detail-float-action h-auto"
            type="button"
            variant="ghost"
            onClick={() => onSearchSameDate(item)}
          >
            <CalendarIcon data-icon="inline-start" />
            <span>Same Date</span>
          </Button>
          <Button
            className="detail-float-action h-auto"
            type="button"
            variant="ghost"
            onClick={() => onRunSimilarSearch(item)}
          >
            <SearchIcon data-icon="inline-start" />
            <span>Similar</span>
          </Button>
          {onConfirmAnswer ? (
            <Button
              className="detail-float-action detail-float-action--primary h-auto"
              type="button"
              onClick={() => onConfirmAnswer(item.id)}
            >
              <CheckIcon data-icon="inline-start" />
              <span>Confirm</span>
            </Button>
          ) : (
            <Button
              className="detail-float-action detail-float-action--primary h-auto"
              type="button"
              onClick={() => onSendSelection(item)}
            >
              <SendIcon data-icon="inline-start" />
              <span>Send</span>
            </Button>
          )}
        </div>

        <div className="video-timeline">
          <Button
            className="video-play-btn"
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause video" : "Play video"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <span className="video-time video-time--elapsed">{playbackTimeLabel(currentTime)}</span>
          <input
            className="video-scrubber"
            type="range"
            min="0"
            max={timelineMax}
            step="0.01"
            value={Math.min(currentTime, timelineMax)}
            aria-label="Video timeline"
            aria-valuetext={`${playbackTimeLabel(currentTime)} of ${playbackTimeLabel(duration)}`}
            style={{ "--video-progress": `${progress}%` } as React.CSSProperties}
            onChange={handleSeek}
            onPointerDown={startScrubbing}
            onPointerUp={stopScrubbing}
            onPointerCancel={stopScrubbing}
            onTouchEnd={stopScrubbing}
            onMouseUp={stopScrubbing}
          />
          <span className="video-time video-time--duration">{playbackTimeLabel(duration)}</span>
          <Button
            className="video-mute-btn"
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={toggleMute}
            aria-label={isMuted ? "Unmute video" : "Mute video"}
          >
            {isMuted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function PhoneViewportFrame({ currentTarget, onSelectCandidate, onConfirmAnswer, onExit }: PhoneViewportFrameProps) {
  const [modeState, dispatch] = useReducer(phoneModeReducer, initialPhoneModeState);
  const mode = modeState.screen;
  const contentMode = modeState.bgContent;
  const modeTransition = modeState.transition;

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<RecallMediaItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SEARCH_BATCH_SIZE);
  const [showHistory, setShowHistory] = useState(false);
  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<RecallMediaItem[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [gridColumns, setGridColumns] = useState<GridColumns>(() => readGridColumns());
  const prefersReducedMotion = useReducedMotion();

  const phoneRectRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const topBarInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<PhoneMode>("home");
  const bgContentRef = useRef(contentMode);
  bgContentRef.current = contentMode;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchGridRef = useRef<HTMLDivElement>(null);
  const favoritesGridRef = useRef<HTMLDivElement>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const hasPrefetchedRef = useRef(false);
  const gridColumnsRef = useRef<GridColumns>(gridColumns);
  const pendingGridSnapshotRef = useRef<GridItemSnapshot | null>(null);
  const gridFlipAnimationsRef = useRef<Animation[]>([]);
  const activeTouchPointersRef = useRef<Map<number, GridPoint>>(new Map());
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const wheelAccumRef = useRef(0);
  const suppressSelectionUntilRef = useRef(0);
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);
  const [isAutoSearchPending, setIsAutoSearchPending] = useState(false);
  const liveRef = useRef({ hasMore: false, submittedQuery: "", query: "", visibleCount: SEARCH_BATCH_SIZE, prefetchedResults: null as RecallMediaItem[] | null });
  const [prefetchedResults, setPrefetchedResults] = useState<RecallMediaItem[] | null>(null);
  const [overscrollProgress, setOverscrollProgress] = useState(0);
  const prevScrollTopRef = useRef(0);
  const [nsfwRevealedIds, setNsfwRevealedIds] = useState<Set<string>>(new Set());
  const [nsfwRevealedAll, setNsfwRevealedAll] = useState(false);
  const [nsfwPendingItem, setNsfwPendingItem] = useState<RecallMediaItem | null>(null);
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);

  const isItemBlurred = useCallback((item: RecallMediaItem) =>
    isItemNsfw(item) && !nsfwRevealedAll && !nsfwRevealedIds.has(item.id),
  [nsfwRevealedAll, nsfwRevealedIds]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
      if (autoSearchTimerRef.current !== null) {
        clearTimeout(autoSearchTimerRef.current);
      }
      gridFlipAnimationsRef.current.forEach((animation) => animation.cancel());
      activeTouchPointersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setDetailItem(null);
    setSelectedItems([]);
    if (modeRef.current === "detail") {
      dispatch({ type: "TARGET_RESET" });
    }
  }, [currentTarget?.id]);

  useEffect(() => {
    const controller = new AbortController();
    listRecentItems(SEARCH_BATCH_SIZE, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.results.length > 0) {
          setResults(response.results);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, index) => makeMockItem(`recent-${index}`)));
      });
    return () => { controller.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingFavorites(true);

    listFavoriteItems(FAVORITES_COUNT, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setFavoriteItems(response.results);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFavoriteItems([]);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsLoadingFavorites(false);
      });

    return () => { controller.abort(); };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSuggestions(history.slice(0, 5));
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggestSearches(q, 6, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          const nextSuggestions = [...response.suggestions, ...localSuggestions(q, history)];
          setSuggestions(
            nextSuggestions
              .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
              .slice(0, 6),
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions(localSuggestions(q, history));
        });
    }, 140);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [history, query]);

  useEffect(() => {
    if (mode === "compose") {
      topBarInputRef.current?.focus();
    }
    modeRef.current = mode;
  }, [contentMode, mode]);

  useEffect(() => {
    if (modeTransition.reason === "search-clear") {
      scrollContainerRef.current?.scrollTo({ top: 0 });
    }
  }, [modeTransition]);

  const gridDensityStyle = useMemo(() => ({
    "--phone-grid-columns": String(gridColumns),
    "--phone-grid-gap": GRID_GAP_BY_COLUMNS[gridColumns],
    "--phone-grid-radius": GRID_RADIUS_BY_COLUMNS[gridColumns],
  }) as React.CSSProperties, [gridColumns]);

  useEffect(() => {
    gridColumnsRef.current = gridColumns;
  }, [gridColumns]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerDownPosRef.current = null;
  }, []);

  const suppressTileSelectionBriefly = useCallback(() => {
    const now = typeof window !== "undefined" ? window.performance.now() : Date.now();
    suppressSelectionUntilRef.current = now + 450;
  }, []);

  const isTileSelectionSuppressed = useCallback(() => {
    const now = typeof window !== "undefined" ? window.performance.now() : Date.now();
    return now < suppressSelectionUntilRef.current;
  }, []);

  const captureGridSnapshot = useCallback((): GridItemSnapshot => {
    const snapshot: GridItemSnapshot = new Map();
    const grids = [favoritesGridRef.current, searchGridRef.current];

    for (const grid of grids) {
      if (!grid) continue;

      const scope = grid.dataset.phoneGridScope ?? "grid";
      grid.querySelectorAll<HTMLElement>("[data-phone-grid-item]").forEach((element) => {
        const id = element.dataset.phoneGridItem;
        if (!id) return;
        snapshot.set(`${scope}:${id}`, element.getBoundingClientRect());
      });
    }

    return snapshot;
  }, []);

  const updateGridColumns = useCallback((nextColumns: GridColumns) => {
    const currentColumns = gridColumnsRef.current;
    if (nextColumns === currentColumns) return;

    pendingGridSnapshotRef.current = captureGridSnapshot();
    gridColumnsRef.current = nextColumns;
    writeGridColumns(nextColumns);
    setGridColumns(nextColumns);
  }, [captureGridSnapshot]);

  useLayoutEffect(() => {
    const snapshot = pendingGridSnapshotRef.current;
    if (!snapshot) return;

    pendingGridSnapshotRef.current = null;
    gridFlipAnimationsRef.current.forEach((animation) => animation.cancel());
    gridFlipAnimationsRef.current = [];

    if (snapshot.size === 0 || reduceMotionEnabled()) return;

    const animations: Animation[] = [];
    const grids = [favoritesGridRef.current, searchGridRef.current];

    for (const grid of grids) {
      if (!grid) continue;

      const scope = grid.dataset.phoneGridScope ?? "grid";
      grid.querySelectorAll<HTMLElement>("[data-phone-grid-item]").forEach((element) => {
        const id = element.dataset.phoneGridItem;
        if (!id) return;

        const first = snapshot.get(`${scope}:${id}`);
        if (!first) return;

        const last = element.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        const scaleX = first.width / Math.max(last.width, 1);
        const scaleY = first.height / Math.max(last.height, 1);
        const moved = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
        const scaled = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;

        if (!moved && !scaled) return;

        const animation = element.animate(
          [
            {
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
              transformOrigin: "center",
            },
            {
              transform: "translate(0, 0) scale(1, 1)",
              transformOrigin: "center",
            },
          ],
          {
            duration: 260,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        );

        animations.push(animation);
        animation.finished
          .catch(() => undefined)
          .finally(() => {
            gridFlipAnimationsRef.current = gridFlipAnimationsRef.current.filter((existing) => existing !== animation);
          });
      });
    }

    gridFlipAnimationsRef.current = animations;
  }, [favoriteItems, gridColumns, isLoading, isLoadingFavorites, isLoadingMore, mode, results]);

  const zoomGridIn = useCallback(() => {
    const index = GRID_COLUMN_OPTIONS.indexOf(gridColumnsRef.current);
    if (index <= 0) return;
    updateGridColumns(GRID_COLUMN_OPTIONS[index - 1]);
  }, [updateGridColumns]);

  const zoomGridOut = useCallback(() => {
    const index = GRID_COLUMN_OPTIONS.indexOf(gridColumnsRef.current);
    if (index >= GRID_COLUMN_OPTIONS.length - 1) return;
    updateGridColumns(GRID_COLUMN_OPTIONS[index + 1]);
  }, [updateGridColumns]);

  const handleGridPointerDownCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;

    activeTouchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activeTouchPointersRef.current.size < 2) return;

    const [first, second] = Array.from(activeTouchPointersRef.current.values());
    const startDistance = pointerDistance(first, second);
    if (startDistance <= 0) return;

    cancelLongPress();
    suppressTileSelectionBriefly();
    pinchGestureRef.current = {
      startColumns: gridColumnsRef.current,
      startDistance,
      midpoint: pointerMidpoint(first, second),
    };
  }, [cancelLongPress, suppressTileSelectionBriefly]);

  const handleGridPointerMoveCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" || !activeTouchPointersRef.current.has(event.pointerId)) return;

    activeTouchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchGestureRef.current;
    if (!pinch || activeTouchPointersRef.current.size < 2) return;

    const [first, second] = Array.from(activeTouchPointersRef.current.values());
    const distance = pointerDistance(first, second);
    if (distance <= 0) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    pinch.midpoint = pointerMidpoint(first, second);
    suppressTileSelectionBriefly();

    const ratio = distance / pinch.startDistance;
    const nextColumns = nearestGridColumns(pinch.startColumns / ratio);
    updateGridColumns(nextColumns);
  }, [suppressTileSelectionBriefly, updateGridColumns]);

  const endGridPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;

    activeTouchPointersRef.current.delete(event.pointerId);
    if (activeTouchPointersRef.current.size < 2 && pinchGestureRef.current) {
      pinchGestureRef.current = null;
      suppressTileSelectionBriefly();
    }
  }, [suppressTileSelectionBriefly]);

  const gridGestureHandlers = useMemo(() => ({
    onPointerDownCapture: handleGridPointerDownCapture,
    onPointerMoveCapture: handleGridPointerMoveCapture,
    onPointerUpCapture: endGridPointer,
    onPointerCancelCapture: endGridPointer,
  }), [endGridPointer, handleGridPointerDownCapture, handleGridPointerMoveCapture]);

  const runSearch = useCallback(async (
    rawQuery: string,
    count = SEARCH_BATCH_SIZE,
    options: { remember?: boolean; fromAuto?: boolean } = {},
  ) => {
    const q = rawQuery.trim();
    const shouldRemember = options.remember ?? true;
    const fromAuto = options.fromAuto === true;

    if (!q) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setIsLoading(false);
      setSubmittedQuery("");
      setResults([]);
      dispatch({ type: "SEARCH_CLEAR" });
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    setIsLoadingMore(false);
    setIsLoading(true);
    setErrorMessage(null);
    setResults([]);
    setVisibleCount(count);

    setShowHistory(false);
    setSubmittedQuery(q);
    if (fromAuto) {
      dispatch({ type: "AUTOSEARCH_COMMIT" });
    } else {
      dispatch({ type: "SEARCH_COMMIT" });
      scrollContainerRef.current?.scrollTo({ top: 0 });
      topBarInputRef.current?.blur();
    }

    try {
      const [semanticResponse, textResponse] = await Promise.allSettled([
        searchSemantic(q, count, { signal: controller.signal }),
        searchText(q, Math.min(count, 30), { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;

      const semanticResults = semanticResponse.status === "fulfilled" ? semanticResponse.value.results : [];
      const textResults = textResponse.status === "fulfilled" ? textResponse.value.results : [];
      const nextResults = mergeResults(semanticResults, textResults).slice(0, count);

      if (nextResults.length > 0) {
        setResults(nextResults);
      } else if (semanticResponse.status === "rejected" && textResponse.status === "rejected") {
        setResults(Array.from({ length: SEARCH_BATCH_SIZE }).map((_, index) => makeMockItem(`${q}-${index}`, q)));
        setErrorMessage("Backend unavailable. Showing sample tiles until the media bundle is indexed.");
      } else {
        setResults([]);
      }

      if (shouldRemember) {
        rememberSearch(q);
        setHistory(readSearchHistory());
      }
    } finally {
      if (!controller.signal.aborted && searchAbortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  const runSimilarSearch = useCallback(async (item: RecallMediaItem) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsLoading(true);
    setErrorMessage(null);
    setResults([]);
    setDetailItem(null);
    dispatch({ type: "SIMILAR_SEARCH" });
    scrollContainerRef.current?.scrollTo({ top: 0 });
    setSubmittedQuery("similar items");
    setQuery("");

    try {
      const response = await searchSimilarById(item.id, SEARCH_BATCH_SIZE, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(response.results);
    } catch {
      if (controller.signal.aborted) return;
      setErrorMessage("Similar search is available after this item has an indexed embedding.");
      setResults([]);
    } finally {
      if (!controller.signal.aborted && searchAbortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  const openDetail = useCallback((item: RecallMediaItem) => {
    if (isItemBlurred(item)) {
      setNsfwPendingItem(item);
      return;
    }
    if (modeRef.current === "detail") return;
    dispatch({ type: "DETAIL_OPEN" });
    setDetailItem(item);
    onSelectCandidate?.(item.id);
  }, [isItemBlurred, onSelectCandidate]);

  const closeDetail = useCallback(() => {
    dispatch({ type: "DETAIL_CLOSE" });
    setDetailItem(null);
  }, []);

  const toggleSelected = useCallback((item: RecallMediaItem) => {
    setSelectedItems((existing) => {
      if (existing.some((candidate) => candidate.id === item.id)) {
        return existing.filter((candidate) => candidate.id !== item.id);
      }
      return [...existing, item];
    });
  }, []);

  const searchSameDate = useCallback((item: RecallMediaItem) => {
    const date = itemDateLabel(item);
    if (!date) {
      setErrorMessage("This item has no date metadata yet.");
      setDetailItem(null);
      dispatch({ type: "SEARCH_COMMIT" });
      return;
    }

    setQuery(date);
    void runSearch(date, SEARCH_BATCH_SIZE);
    setDetailItem(null);
  }, [runSearch]);

  const sendSelection = useCallback((item?: RecallMediaItem) => {
    const nextSelection = item && !selectedItems.some((candidate) => candidate.id === item.id)
      ? [...selectedItems, item]
      : selectedItems;
    setSelectedItems(nextSelection);
  }, [selectedItems]);

  const handleToggleFavorite = useCallback(async (item: RecallMediaItem) => {
    const current = item.metadata.organization?.favorite ?? false;
    const patch = { organization: { favorite: !current } };
    try {
      const updated = await patchCatalogItem(item.id, patch);
      if (detailItem?.id === item.id) {
        setDetailItem(updated);
      }
      const existsInFavorites = favoriteItems.some((f) => f.id === item.id);
      if (existsInFavorites && current) {
        setFavoriteItems((prev) => prev.filter((f) => f.id !== item.id));
      } else if (!existsInFavorites && !current) {
        setFavoriteItems((prev) => [updated, ...prev]);
      } else {
        setFavoriteItems((prev) =>
          prev.map((f) => (f.id === item.id ? updated : f)),
        );
      }
    } catch {
      // no-op
    }
  }, [detailItem, favoriteItems]);

  const handleToggleSafety = useCallback(async (item: RecallMediaItem, state: "safe" | "nsfw") => {
    const patch = { safety: { state } };
    try {
      const updated = await patchCatalogItem(item.id, patch);
      if (detailItem?.id === item.id) {
        setDetailItem(updated);
      }
      if (state === "safe") {
        setNsfwRevealedIds((prev) => new Set([...prev, item.id]));
        setNsfwPendingItem(null);
      }
    } catch {
      // no-op
    }
  }, [detailItem]);

  const removeHistoryItem = useCallback((item: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.toLowerCase() !== item.toLowerCase());
      writeSearchHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    writeSearchHistory([]);
  }, []);

  const abortActiveSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setIsLoading(false);
  }, []);

  const enterComposeMode = useCallback((options: { showHistory?: boolean } = {}) => {
    if (modeRef.current !== "compose") {
      dispatch({ type: "SEARCH_FOCUS", startQuery: query });
    }
    if (typeof options.showHistory === "boolean") {
      setShowHistory(options.showHistory);
    }
  }, [query]);

  const closeComposeMode = useCallback(() => {
    setQuery(modeState.composeStartQuery);
    setShowHistory(false);
    setHistory(readSearchHistory());
    dispatch({ type: "COMPOSE_DISMISS" });
    topBarInputRef.current?.blur();
  }, [modeState.composeStartQuery]);

  const prefetchNextBatch = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, visibleCount: vc } = liveRef.current;
    if (!live || hasPrefetchedRef.current || !sq) return;
    hasPrefetchedRef.current = true;
    prefetchAbortRef.current?.abort();
    const controller = new AbortController();
    prefetchAbortRef.current = controller;
    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [semanticResponse, textResponse] = await Promise.allSettled([
        searchSemantic(sq, nextCount, { signal: controller.signal }),
        searchText(sq, Math.min(nextCount, 30), { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const semanticResults = semanticResponse.status === "fulfilled" ? semanticResponse.value.results : [];
      const textResults = textResponse.status === "fulfilled" ? textResponse.value.results : [];
      const nextResults = mergeResults(semanticResults, textResults).slice(0, nextCount);
      if (nextResults.length > 0) setPrefetchedResults(nextResults);
    } catch {
      if (!controller.signal.aborted) hasPrefetchedRef.current = false;
    }
  }, []);

  const loadMore = useCallback(async () => {
    const { hasMore: live, submittedQuery: sq, query: q, visibleCount: vc, prefetchedResults: cached } = liveRef.current;
    if (!live) return;

    if (cached) {
      setResults(cached);
      setVisibleCount(vc + SEARCH_BATCH_SIZE);
      setErrorMessage(null);
      setPrefetchedResults(null);
      hasPrefetchedRef.current = false;
      return;
    }

    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setIsLoadingMore(true);

    const nextCount = vc + SEARCH_BATCH_SIZE;
    try {
      const [semanticResponse, textResponse] = await Promise.allSettled([
        searchSemantic(sq || q, nextCount, { signal: controller.signal }),
        searchText(sq || q, Math.min(nextCount, 30), { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const semanticResults = semanticResponse.status === "fulfilled" ? semanticResponse.value.results : [];
      const textResults = textResponse.status === "fulfilled" ? textResponse.value.results : [];
      const nextResults = mergeResults(semanticResults, textResults).slice(0, nextCount);
      if (nextResults.length > 0) {
        setResults(nextResults);
        setVisibleCount(nextCount);
      }
    } finally {
      if (!controller.signal.aborted) setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    hasPrefetchedRef.current = false;
    setPrefetchedResults(null);
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;
  }, [submittedQuery]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "results") return;
    const handleScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) void prefetchNextBatch();
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode, prefetchNextBatch]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "results") return;
    let hitBottomAtY: number | null = null;
    let touchStartY = 0;
    let currentOverscroll = 0;
    const isAtBottom = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      hitBottomAtY = null;
      currentOverscroll = 0;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const touchY = e.touches[0].clientY;
      if (isAtBottom()) {
        if (hitBottomAtY === null && touchStartY > touchY) hitBottomAtY = touchY;
        if (hitBottomAtY !== null) {
          const delta = Math.max(0, hitBottomAtY - touchY);
          currentOverscroll = delta;
          if (delta > 0) {
            e.preventDefault();
            setOverscrollProgress(Math.min(1, delta / OVERSCROLL_THRESHOLD));
          }
        }
      } else if (currentOverscroll > 0) {
        currentOverscroll = 0;
        hitBottomAtY = null;
        setOverscrollProgress(0);
      }
    };
    const handleTouchEnd = () => {
      const delta = currentOverscroll;
      currentOverscroll = 0;
      setOverscrollProgress(0);
      if (delta >= OVERSCROLL_THRESHOLD && liveRef.current.hasMore) {
        const { prefetchedResults: cached, visibleCount: vc } = liveRef.current;
        if (cached) {
          setResults(cached);
          setVisibleCount(vc + SEARCH_BATCH_SIZE);
          setErrorMessage(null);
          setPrefetchedResults(null);
          hasPrefetchedRef.current = false;
        } else {
          void loadMore();
        }
      }
    };
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // SR-1: dismiss compose on downward scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const st = el.scrollTop;
      const prev = prevScrollTopRef.current;

      if (st > prev && modeRef.current === "compose") {
        dispatch({ type: "COMPOSE_DISMISS" });
        topBarInputRef.current?.blur();
      }

      prevScrollTopRef.current = st;
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [mode]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const currentMode = modeRef.current;
      if (currentMode !== "home" && currentMode !== "results") return;

      e.preventDefault();

      const normalized = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;
      wheelAccumRef.current += normalized;

      if (wheelAccumRef.current > 60) {
        wheelAccumRef.current = 0;
        zoomGridOut();
      } else if (wheelAccumRef.current < -60) {
        wheelAccumRef.current = 0;
        zoomGridIn();
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [zoomGridIn, zoomGridOut]);

  const handleItemPointerDown = useCallback((e: React.PointerEvent, item: RecallMediaItem) => {
    e.stopPropagation();
    if (isTileSelectionSuppressed()) {
      cancelLongPress();
      return;
    }
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    if (!isItemBlurred(item)) {
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        longPressTimerRef.current = null;
        openDetail(item);
      }, 500);
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, openDetail]);

  const handleItemPointerUp = useCallback((_e: React.PointerEvent, item: RecallMediaItem) => {
    cancelLongPress();
    if (isTileSelectionSuppressed()) return;
    if (!longPressTriggeredRef.current) {
      if (isItemBlurred(item)) {
        setNsfwPendingItem(item);
      } else {
        toggleSelected(item);
      }
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, toggleSelected]);

  const handleItemPointerMove = useCallback((e: React.PointerEvent) => {
    if (longPressTimerRef.current !== null && pointerDownPosRef.current) {
      const dx = e.clientX - pointerDownPosRef.current.x;
      const dy = e.clientY - pointerDownPosRef.current.y;
      if (dx * dx + dy * dy > 64) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  const handleItemPointerCancel = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const refinements = useMemo(
    () => suggestions.filter((s) => s.toLowerCase() !== submittedQuery.toLowerCase()).slice(0, 4),
    [suggestions, submittedQuery],
  );
  const visibleHistory = history.length > 0 ? history : readSearchHistory();
  const activeHistory = showHistory ? readSearchHistory() : visibleHistory;
  const composeQuery = query.trim();
  const composeSuggestions = composeQuery ? suggestions.slice(0, 3) : [];
  const usesNaturalAspectGrid = gridColumns === 1;
  const mediaGridClassName = `grid phone-media-grid${usesNaturalAspectGrid ? " phone-media-grid--natural" : ""}`;
  const hasMore = results.length >= visibleCount && contentMode === "results";
  const showSelectionTray = selectedItems.length > 0 && mode !== "detail" && mode !== "compose";
  const showFavoritesSection = isLoadingFavorites || favoriteItems.length > 0;
  liveRef.current = { hasMore, submittedQuery, query, visibleCount, prefetchedResults };

  const handleAssistSearch = useCallback((nextQuery: string) => {
    setShowHistory(false);
    setQuery(nextQuery);
    void runSearch(nextQuery);
  }, [runSearch]);

  const handleSearchHistoryToggle = useCallback(() => {
    if (modeRef.current !== "compose") {
      enterComposeMode({ showHistory: true });
      return;
    }
    setShowHistory((prev) => !prev);
  }, [enterComposeMode]);

  const handleSearchFocus = useCallback(() => {
    enterComposeMode();
  }, [enterComposeMode]);

  const cancelAutoSearch = useCallback(() => {
    if (autoSearchTimerRef.current !== null) {
      window.clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
    setIsAutoSearchPending(false);
  }, []);

  const handleSearchChange = useCallback((nextQuery: string) => {
    if (nextQuery === "" && bgContentRef.current === "results") {
      cancelAutoSearch();
      abortActiveSearch();
      setQuery("");
      setSubmittedQuery("");
      setShowHistory(false);
      setHistory(readSearchHistory());
      dispatch({ type: "SEARCH_CLEAR" });
      topBarInputRef.current?.blur();
      return;
    }
    setQuery(nextQuery);
    setShowHistory(false);
    if (modeRef.current !== "compose") {
      enterComposeMode();
    }
  }, [abortActiveSearch, cancelAutoSearch, enterComposeMode]);

  const handleSearchSubmit = useCallback(() => {
    cancelAutoSearch();
    void runSearch(query);
  }, [cancelAutoSearch, query, runSearch]);

  const handleSearchClear = useCallback(() => {
    cancelAutoSearch();
    abortActiveSearch();
    if (modeRef.current === "compose" && bgContentRef.current !== "results") {
      setQuery("");
      setShowHistory(true);
      return;
    }
    setQuery("");
    setSubmittedQuery("");
    setShowHistory(false);
    setHistory(readSearchHistory());
    dispatch({ type: "SEARCH_CLEAR" });
    topBarInputRef.current?.blur();
  }, [abortActiveSearch, cancelAutoSearch]);

  useEffect(() => {
    if (autoSearchTimerRef.current !== null) {
      clearTimeout(autoSearchTimerRef.current);
      autoSearchTimerRef.current = null;
    }
    const q = query.trim();
    if (modeRef.current !== "compose" || q.length < 2) {
      setIsAutoSearchPending(false);
      return;
    }
    setIsAutoSearchPending(true);
    autoSearchTimerRef.current = setTimeout(() => {
      autoSearchTimerRef.current = null;
      setIsAutoSearchPending(false);
      void runSearch(q, SEARCH_BATCH_SIZE, { remember: false, fromAuto: true });
    }, 400);
    return () => {
      if (autoSearchTimerRef.current !== null) {
        clearTimeout(autoSearchTimerRef.current);
        autoSearchTimerRef.current = null;
      }
      setIsAutoSearchPending(false);
    };
  }, [query, runSearch]);

  const isSearching = isAutoSearchPending || (isLoading && mode === "compose");

  const renderSearchBar = (className?: string, clearLabel = "Clear search") => (
    <PhoneSearchBar
      ref={topBarInputRef}
      value={query}
      className={className}
      clearLabel={clearLabel}
      showHistory={showHistory}
      isSearching={isSearching}
      onToggleHistory={handleSearchHistoryToggle}
      onFocus={handleSearchFocus}
      onChange={handleSearchChange}
      onSubmit={handleSearchSubmit}
      onClear={handleSearchClear}
    />
  );

  return (
    <div
      ref={phoneRectRef}
      className={`phone-rect${contentMode === "home" ? " phone-rect--home" : ""}${showSelectionTray ? " phone-rect--has-selection" : ""}`}
      style={gridDensityStyle}
      data-reduced-motion={prefersReducedMotion ? "true" : undefined}
      aria-label="Phone interface viewport"
      onKeyDown={(event) => {
        if (event.key === "Escape" && modeRef.current === "compose") {
          closeComposeMode();
          return;
        }
        if (event.key === "Escape" && mode !== "home") {
          abortActiveSearch();
          setQuery("");
          setSubmittedQuery("");
          setShowHistory(false);
          setHistory(readSearchHistory());
          dispatch({ type: "SEARCH_CLEAR" });
          topBarInputRef.current?.blur();
        }
      }}
    >
        {mode === "results" && hasMore ? (
          <div
            className={`pull-indicator${overscrollProgress > 0 ? " pull-indicator--visible" : ""}${overscrollProgress >= 1 ? " pull-indicator--ready" : ""}`}
            aria-hidden
          >
            <svg className="pull-indicator-ring" viewBox="0 0 20 20">
              <circle className="pull-indicator-track" cx="10" cy="10" r="8" />
              <circle
                className="pull-indicator-fill"
                cx="10" cy="10" r="8"
                style={{ strokeDashoffset: 50.3 * (1 - overscrollProgress) }}
              />
            </svg>
            <span>{overscrollProgress >= 1 ? "Release!" : "More results"}</span>
          </div>
        ) : null}

        <MotionConfig reducedMotion="user">
        <LayoutGroup id="phone-ui">

        {/* Persistent section — bar + accordion suggestions in normal flow */}
        {mode !== "home" && !(mode === "compose" && contentMode === "home") ? (
          <div className="phone-persistent-section phone-persistent-search">
            <div className={`search-panel${mode === "compose" ? " search-panel--expanded" : ""}`}>
              {renderSearchBar()}
              <AnimatePresence initial={false}>
                {mode === "compose" ? (
                  <motion.div
                    key="compose-results-inline"
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="phone-compose-section">
                      <SearchAssistPanel
                        query={query}
                        showHistory={showHistory}
                        history={activeHistory}
                        suggestions={composeSuggestions}
                        knownHistory={visibleHistory}
                        isSearching={isSearching}
                        onRunSearch={handleAssistSearch}
                        onClearHistory={clearHistory}
                        onRemoveHistoryItem={removeHistoryItem}
                      />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        ) : null}

        {/* Main scrollable content */}
        <ScrollArea
          className="phone-rect-content"
          viewportRef={scrollContainerRef}
          viewportClassName="phone-rect-viewport"
          onPointerDownCapture={mode === "compose" && contentMode !== "home" ? () => dispatch({ type: "COMPOSE_DISMISS" }) : undefined}
        >
          <>
            {contentMode === "home" ? (
              <motion.div
                key="screen-home"
                className="phone-screen phone-screen--home"
                custom={modeTransition}
                variants={screenMotionVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                <div className="phone-startpage">
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{
                  height: mode === "compose" ? 0 : "auto",
                  opacity: mode === "compose" ? 0 : 1,
                  y: mode === "compose" ? -16 : 0,
                }}
                transition={{ duration: 0.26, ease: MOTION_EASE.standard }}
                style={{ overflow: "hidden" }}
              >
                <div className="phone-startpage-header">
                  <div className="phone-startpage-brand">
                    <div className="phone-startpage-logo" aria-hidden>
                      <SearchIcon />
                    </div>
                    <h1 className="phone-startpage-title">Recall</h1>
                  </div>
                  <div className="phone-startpage-actions">
                    <Avatar className="phone-avatar" aria-label="Profile">
                      <AvatarFallback>
                        <UserIcon className="size-3.5" />
                      </AvatarFallback>
                    </Avatar>
                    {onExit ? (
                      <Button
                        className="phone-exit-btn"
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={onExit}
                        aria-label="Exit phone tester"
                      >
                        <XIcon />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </motion.div>

              <div className="phone-startpage-search-sticky">
                <div className={`search-panel${mode === "compose" ? " search-panel--expanded" : ""}`}>
                  {renderSearchBar(undefined, "Clear draft search")}
                  <AnimatePresence initial={false}>
                    {mode === "compose" ? (
                      <motion.div
                        key="compose-home-inline"
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                        style={{ overflow: "hidden" }}
                      >
                        <div className="phone-compose-section">
                          <SearchAssistPanel
                            query={query}
                            showHistory={showHistory}
                            history={activeHistory}
                            suggestions={composeSuggestions}
                            knownHistory={visibleHistory}
                            isSearching={isSearching}
                            onRunSearch={handleAssistSearch}
                            onClearHistory={clearHistory}
                            onRemoveHistoryItem={removeHistoryItem}
                          />
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>

	              {showFavoritesSection ? (
                <FavoritesSection
                  favoriteItems={favoriteItems}
                  favoritesGridRef={favoritesGridRef}
                  gridClassName={mediaGridClassName}
                  gridGestureHandlers={gridGestureHandlers}
                  gridColumns={gridColumns}
                  isLoadingFavorites={isLoadingFavorites}
                  naturalAspectRatio={usesNaturalAspectGrid}
                  selectedItems={selectedItems}
                  isItemBlurred={isItemBlurred}
                  onZoomIn={zoomGridIn}
                  onZoomOut={zoomGridOut}
                  onItemPointerDown={handleItemPointerDown}
                  onItemPointerUp={handleItemPointerUp}
                  onItemPointerMove={handleItemPointerMove}
                  onItemPointerCancel={handleItemPointerCancel}
                  toggleSelected={toggleSelected}
                />
              ) : null}

                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="screen-search"
                    className={`phone-screen phone-screen--search${mode === "compose" ? " phone-screen--dimmed" : ""}${isLoading && mode === "results" && contentMode === "results" ? " phone-screen--loading" : ""}`}
                    custom={modeTransition}
                    variants={screenMotionVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                  >
                    <ResultsSection
                      results={results}
                      searchGridRef={searchGridRef}
                      gridClassName={mediaGridClassName}
                      gridGestureHandlers={gridGestureHandlers}
                      gridColumns={gridColumns}
                      isLoading={isLoading}
                      isLoadingMore={isLoadingMore}
                      contentMode={contentMode}
                      submittedQuery={submittedQuery}
                      errorMessage={errorMessage}
                      hasMore={hasMore}
                      refinements={refinements}
                      naturalAspectRatio={usesNaturalAspectGrid}
                      selectedItems={selectedItems}
                      isItemBlurred={isItemBlurred}
                      onZoomIn={zoomGridIn}
                      onZoomOut={zoomGridOut}
                      onItemPointerDown={handleItemPointerDown}
                      onItemPointerUp={handleItemPointerUp}
                      onItemPointerMove={handleItemPointerMove}
                      onItemPointerCancel={handleItemPointerCancel}
                      toggleSelected={toggleSelected}
                      onLoadMore={() => void loadMore()}
                      onRunRefinement={(refinement) => {
                        setQuery(refinement);
                        void runSearch(refinement);
                      }}
                    />
                  </motion.div>
                )}
          </>
        </ScrollArea>

        {/* Detail view — outside ScrollArea so it covers the persistent search bar */}
        <AnimatePresence initial={false}>
          {mode === "detail" && detailItem && (
            isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
              <VideoDetailView
                key={detailItem.id}
                item={detailItem}
                onBack={closeDetail}
                onSearchSameDate={searchSameDate}
                onRunSimilarSearch={(item) => void runSimilarSearch(item)}
                onConfirmAnswer={onConfirmAnswer}
                onSendSelection={sendSelection}
                onToggleFavorite={handleToggleFavorite}
                onToggleSafety={handleToggleSafety}
                onOpenAbout={setAboutSheetItem}
                layoutId={mediaLayoutId(detailItem.id)}
              />
            ) : (
              <motion.div
                key={detailItem.id}
                className="detail-screen phone-detail-motion"
                aria-label={`${itemTitle(detailItem)} detail view`}
                variants={detailBackdropMotion}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <motion.div
                  className="detail-media-fill phone-detail-media-motion"
                  layoutId={mediaLayoutId(detailItem.id)}
                  transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
                >
                  <img src={resolvedMediaUrl(detailItem) ?? detailItem.links?.media ?? detailItem.links?.thumbnail} alt={itemTitle(detailItem)} onContextMenu={(e) => e.preventDefault()} />
                </motion.div>

                <div className="detail-float-top">
                  <Button
                    className="detail-float-btn"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={closeDetail}
                    aria-label="Back"
                  >
                    <ChevronLeftIcon />
                  </Button>
                  {itemDateLabel(detailItem) ? (
                    <Badge variant="outline" className="detail-float-info">
                      <span>{itemDateLabel(detailItem)}</span>
                    </Badge>
                  ) : <div className="detail-float-info-spacer" />}
                  <Button
                    className="detail-float-btn"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleToggleFavorite(detailItem)}
                    aria-label={detailItem.metadata.organization?.favorite ? "Remove from favorites" : "Add to favorites"}
                  >
                    {detailItem.metadata.organization?.favorite ? (
                      <StarIcon fill="currentColor" />
                    ) : (
                      <StarIcon />
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        className="detail-float-btn"
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="More actions"
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {detailItem.metadata.safety?.state === "nsfw" ? (
                        <DropdownMenuItem onClick={() => handleToggleSafety(detailItem, "safe")}>
                          <ShieldCheckIcon />
                          Mark as Safe
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => handleToggleSafety(detailItem, "nsfw")}>
                          <ShieldAlertIcon />
                          Mark as NSFW
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setAboutSheetItem(detailItem)}>
                        <InfoIcon />
                        About
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="detail-float-bottom" role="group" aria-label="Detail actions">
                  <Button
                    className="detail-float-action h-auto"
                    type="button"
                    variant="ghost"
                    onClick={() => searchSameDate(detailItem)}
                  >
                    <CalendarIcon data-icon="inline-start" />
                    <span>Same Date</span>
                  </Button>
                  <Button
                    className="detail-float-action h-auto"
                    type="button"
                    variant="ghost"
                    onClick={() => void runSimilarSearch(detailItem)}
                  >
                    <SearchIcon data-icon="inline-start" />
                    <span>Similar</span>
                  </Button>
                  {onConfirmAnswer ? (
                    <Button
                      className="detail-float-action detail-float-action--primary h-auto"
                      type="button"
                      onClick={() => onConfirmAnswer(detailItem.id)}
                    >
                      <CheckIcon data-icon="inline-start" />
                      <span>Confirm Answer</span>
                    </Button>
                  ) : (
                    <Button
                      className="detail-float-action detail-float-action--primary h-auto"
                      type="button"
                      onClick={() => sendSelection(detailItem)}
                    >
                      <SendIcon data-icon="inline-start" />
                      <span>Send</span>
                    </Button>
                  )}
                </div>
              </motion.div>
            )
          )}
        </AnimatePresence>

        </LayoutGroup>
        </MotionConfig>


        {/* NSFW reveal dialog */}
        {nsfwPendingItem && (
          <NsfwDialog
            item={nsfwPendingItem}
            onKeepHidden={() => setNsfwPendingItem(null)}
            onRevealOne={(id) => { setNsfwRevealedIds((prev) => new Set([...prev, id])); setNsfwPendingItem(null); }}
            onRevealAll={() => { setNsfwRevealedAll(true); setNsfwPendingItem(null); }}
            onMarkSafe={(item) => void handleToggleSafety(item, "safe")}
          />
        )}

        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false}>
            {aboutSheetItem && (
              <AboutSheet item={aboutSheetItem} onClose={() => setAboutSheetItem(null)} />
            )}
          </AnimatePresence>
        </MotionConfig>

        {/* Selection tray — floats above the scroll area */}
        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false}>
            {showSelectionTray && (
              <motion.div
                className="selection-tray"
                role="region"
                aria-label="Selection tray"
                aria-live="polite"
                initial={{ opacity: 0, y: 22, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.985 }}
                transition={{ duration: 0.22, ease: MOTION_EASE.gentle }}
              >
                <div className="selection-tray-content">
                  <div className="selection-thumbs" aria-label="Selected items">
                    {selectedItems.map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        variant="ghost"
                        className="selection-thumb-btn h-auto"
                        onClick={() => toggleSelected(item)}
                        aria-label={`Remove ${itemTitle(item)} from selection`}
                      >
                        <span className="selection-thumb-x" aria-hidden>
                          <XIcon />
                        </span>
                        <img src={resolvedThumbnailUrl(item) ?? item.links?.thumbnail ?? item.links?.media} alt="" loading="lazy" decoding="async" />
                      </Button>
                    ))}
                  </div>
                  <div className="selection-tray-actions">
                    <Badge variant="secondary" className="selection-count">{selectedItems.length} selected</Badge>
                    <Button
                      className="send-btn h-auto"
                      type="button"
                      onClick={() => {
                        if (onConfirmAnswer && selectedItems.length > 0) {
                          onConfirmAnswer(selectedItems[0].id);
                        }
                        setSelectedItems([]);
                      }}
                    >
                      {onConfirmAnswer ? (
                        <CheckIcon data-icon="inline-start" />
                      ) : (
                        <SendIcon data-icon="inline-start" />
                      )}
                      {onConfirmAnswer ? "Confirm" : "Send"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </MotionConfig>
    </div>
  );
}
