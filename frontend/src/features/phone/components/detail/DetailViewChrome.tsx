import React, { useRef, useState } from "react";
import { motion, useMotionValue, usePresenceData, useTransform } from "motion/react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  MoreHorizontalIcon,
  SearchIcon,
  SendIcon,
  StarIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isFavorite, isNsfw, isVideo, resolvedDisplayUrl, resolvedMediaUrl, resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import {
  DETAIL_SWIPE_THRESHOLD,
  DETAIL_SWIPE_VERTICAL_TOLERANCE,
  itemDateLabel,
  itemTitle,
  MOTION_EASE,
  PHONE_MOTION,
} from "../../phoneUtils";
import { SensitiveDetailPrompt } from "./SensitiveDetailPrompt";

export type DetailNeighborPreview = {
  item: RecallMediaItem;
  isSensitiveHidden: boolean;
};

type DetailScreenProps = {
  children: React.ReactNode;
  className?: string;
  controls?: React.ReactNode;
  canNavigateNext?: boolean;
  canNavigatePrevious?: boolean;
  isSensitiveHidden?: boolean;
  item: RecallMediaItem;
  layoutId?: string;
  mediaClassName?: string;
  navigationDirection?: -1 | 0 | 1;
  nextPreview?: DetailNeighborPreview | null;
  onBack: () => void;
  onNavigate?: (direction: 1 | -1) => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  onRevealSensitive?: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
  previousPreview?: DetailNeighborPreview | null;
  topBarClassName?: string;
};

type DetailTopBarProps = {
  className?: string;
  isSensitiveHidden?: boolean;
  item: RecallMediaItem;
  onBack: () => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
};

type DetailActionRowProps = {
  ariaLabel?: string;
  className?: string;
  confirmLabel?: string;
  item: RecallMediaItem;
  onConfirmAnswer?: (id: string) => void;
  onRunSimilarSearch: (item: RecallMediaItem) => void;
  onSearchSameDate: (item: RecallMediaItem) => void;
  onSendSelection: (item: RecallMediaItem) => void;
  role?: React.AriaRole;
};

const detailBackdropMotion = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
    transition: { duration: 0.16, ease: MOTION_EASE.gentle },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.16, ease: MOTION_EASE.exit },
  },
};

const detailMediaMotion = {
  initial: (direction: -1 | 0 | 1) => ({
    opacity: direction === 0 ? 1 : 0.92,
    x: direction === 0 ? 0 : `${direction * 100}%`,
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.24, ease: MOTION_EASE.gentle },
  },
  exit: (direction: -1 | 0 | 1) => ({
    opacity: direction === 0 ? 1 : 0.92,
    x: direction === 0 ? 0 : `${direction * -100}%`,
    transition: { duration: direction === 0 ? 0 : 0.2, ease: MOTION_EASE.exit },
  }),
};

const neighborPreviewMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.16, ease: MOTION_EASE.gentle } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: MOTION_EASE.exit } },
};

function shouldIgnoreDetailDragTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("button, [role='button'], a, input, textarea, select, [role='menu'], [role='menuitem']"));
}

function DetailMediaPreview({ preview, position }: { preview: DetailNeighborPreview | null | undefined; position: "previous" | "next" }) {
  if (!preview) return null;
  const { item, isSensitiveHidden } = preview;
  const src = isVideo(item)
    ? resolvedThumbnailUrl(item) ?? item.links?.thumbnail
    : resolvedDisplayUrl(item) ?? resolvedMediaUrl(item) ?? item.links?.media ?? item.links?.thumbnail;
  if (!src) return null;

  return (
    <motion.div
      className={`detail-media-neighbor detail-media-neighbor--${position}${isSensitiveHidden ? " detail-media-neighbor--sensitive-hidden" : ""}`}
      variants={neighborPreviewMotion}
      initial="initial"
      animate="animate"
      exit="exit"
      aria-hidden
    >
      <img src={src} alt="" draggable={false} decoding="async" loading="eager" />
      {isSensitiveHidden ? (
        <div className="detail-media-neighbor-sensitive-label">
          <EyeOffIcon aria-hidden />
          <span>Hidden</span>
        </div>
      ) : null}
    </motion.div>
  );
}

export function DetailScreen({
  children,
  className = "",
  canNavigateNext = false,
  canNavigatePrevious = false,
  controls,
  isSensitiveHidden = false,
  item,
  layoutId,
  mediaClassName = "",
  navigationDirection = 0,
  nextPreview = null,
  onBack,
  onNavigate,
  onOpenAbout,
  onRevealSensitive,
  onToggleFavorite,
  onToggleSafety,
  previousPreview = null,
  topBarClassName,
}: DetailScreenProps) {
  const presenceDirection = usePresenceData() as -1 | 0 | 1 | undefined;
  const activeDirection = presenceDirection ?? navigationDirection;
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number; isHorizontal: boolean | null } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; isHorizontal: boolean | null } | null>(null);
  const lastNavigateAtRef = useRef(0);
  const [isDraggingDetail, setIsDraggingDetail] = useState(false);
  const dragX = useMotionValue(0);
  const dragOpacity = useTransform(dragX, [-160, 0, 160], [0.86, 1, 0.86]);
  const railX = isDraggingDetail ? dragX : 0;

  const commitSwipe = (dx: number, dy: number) => {
    if (!onNavigate) return;
    if (Math.abs(dx) < DETAIL_SWIPE_THRESHOLD || Math.abs(dy) > DETAIL_SWIPE_VERTICAL_TOLERANCE) return;
    const now = typeof window !== "undefined" ? window.performance.now() : Date.now();
    if (now - lastNavigateAtRef.current < 180) return;
    lastNavigateAtRef.current = now;
    onNavigate(dx < 0 ? 1 : -1);
  };

  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (shouldIgnoreDetailDragTarget(event.target)) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, isHorizontal: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.isHorizontal === null && Math.hypot(dx, dy) > 8) {
      start.isHorizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
    }
    if (!start.isHorizontal) return;
    event.preventDefault();
    const constrainedDx = (dx > 0 && !canNavigatePrevious) || (dx < 0 && !canNavigateNext)
      ? dx * 0.22
      : dx;
    setIsDraggingDetail(true);
    dragX.set(constrainedDx);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    setIsDraggingDetail(false);
    dragX.set(0);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!start || start.pointerId !== event.pointerId || !start.isHorizontal) return;
    commitSwipe(event.clientX - start.x, event.clientY - start.y);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (pointerStartRef.current) return;
    if (shouldIgnoreDetailDragTarget(event.target) || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, isHorizontal: null };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (pointerStartRef.current) return;
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (start.isHorizontal === null && Math.hypot(dx, dy) > 8) {
      start.isHorizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
    }
    if (!start.isHorizontal) return;
    event.preventDefault();
    const constrainedDx = (dx > 0 && !canNavigatePrevious) || (dx < 0 && !canNavigateNext)
      ? dx * 0.22
      : dx;
    setIsDraggingDetail(true);
    dragX.set(constrainedDx);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (pointerStartRef.current) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    setIsDraggingDetail(false);
    dragX.set(0);
    const touch = event.changedTouches[0];
    if (!start || !touch || !start.isHorizontal) return;
    commitSwipe(touch.clientX - start.x, touch.clientY - start.y);
  };

  return (
    <motion.div
      className={`detail-screen phone-detail-motion${className ? ` ${className}` : ""}${isSensitiveHidden ? " detail-screen--sensitive-hidden" : ""}`}
      aria-label={`${itemTitle(item)} detail view`}
      variants={detailBackdropMotion}
      initial="initial"
      animate="animate"
      exit="exit"
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStartRef.current = null; setIsDraggingDetail(false); dragX.set(0); }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { touchStartRef.current = null; setIsDraggingDetail(false); dragX.set(0); }}
    >
      <motion.div
        className="detail-media-rail phone-detail-media-motion"
        variants={detailMediaMotion}
        custom={activeDirection}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ x: railX, opacity: isDraggingDetail ? dragOpacity : 1 }}
        transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
      >
        <DetailMediaPreview preview={previousPreview} position="previous" />
        <motion.div
          className={`detail-media-fill detail-media-fill--current${mediaClassName ? ` ${mediaClassName}` : ""}${isSensitiveHidden ? " detail-media-fill--sensitive-hidden" : ""}`}
          layoutId={navigationDirection === 0 ? layoutId : undefined}
          transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
        >
          {children}
        </motion.div>
        <DetailMediaPreview preview={nextPreview} position="next" />
      </motion.div>
      {isSensitiveHidden && onRevealSensitive ? (
        <SensitiveDetailPrompt item={item} onView={onRevealSensitive} />
      ) : null}
      <DetailTopBar
        className={topBarClassName}
        isSensitiveHidden={isSensitiveHidden}
        item={item}
        onBack={onBack}
        onOpenAbout={onOpenAbout}
        onToggleFavorite={onToggleFavorite}
        onToggleSafety={onToggleSafety}
      />
      {onNavigate && canNavigatePrevious ? (
        <Button
          className="detail-side-nav detail-side-nav--prev"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onNavigate(-1)}
          aria-label="Previous item"
          title="Previous item"
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}
      {onNavigate && canNavigateNext ? (
        <Button
          className="detail-side-nav detail-side-nav--next"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onNavigate(1)}
          aria-label="Next item"
          title="Next item"
        >
          <ChevronRightIcon />
        </Button>
      ) : null}
      {!isSensitiveHidden ? controls : null}
    </motion.div>
  );
}

export function DetailTopBar({
  className = "",
  isSensitiveHidden = false,
  item,
  onBack,
  onOpenAbout,
  onToggleFavorite,
  onToggleSafety,
}: DetailTopBarProps) {
  return (
    <div className={`detail-float-top${className ? ` ${className}` : ""}`}>
      <Button className="detail-float-btn" type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back">
        <ChevronLeftIcon />
      </Button>
      {itemDateLabel(item) ? (
        <Badge variant="outline" className="detail-float-info">
          <span>{itemDateLabel(item)}</span>
        </Badge>
      ) : <div className="detail-float-info-spacer" />}
      {!isSensitiveHidden ? (
        <>
          <Button
            className="detail-float-btn"
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggleFavorite(item)}
            aria-label={isFavorite(item) ? "Remove from favorites" : "Add to favorites"}
          >
            {isFavorite(item) ? <StarIcon fill="currentColor" /> : <StarIcon />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="detail-float-btn" type="button" variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="detail-menu">
              <DropdownMenuItem
                className="detail-menu-toggle-item"
                onSelect={(event) => event.preventDefault()}
                onClick={(event) => event.stopPropagation()}
              >
                {isNsfw(item) ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
                <label className="detail-menu-toggle-label" htmlFor={`detail-hidden-${item.id}`}>
                  Hidden
                </label>
                <Switch
                  id={`detail-hidden-${item.id}`}
                  className="detail-menu-switch"
                  checked={isNsfw(item)}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) => onToggleSafety(item, checked ? "nsfw" : "safe")}
                  aria-label={isNsfw(item) ? "Hide item is on" : "Hide item is off"}
                />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onOpenAbout(item)}>
                <InfoIcon />
                About
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );
}

export function DetailActionRow({
  ariaLabel,
  className = "",
  confirmLabel = "Send",
  item,
  onConfirmAnswer,
  onRunSimilarSearch,
  onSearchSameDate,
  onSendSelection,
  role,
}: DetailActionRowProps) {
  return (
    <div className={className} role={role} aria-label={ariaLabel}>
      <Button className="detail-float-action h-auto" type="button" variant="ghost" onClick={() => onSearchSameDate(item)}>
        <CalendarIcon data-icon="inline-start" />
        <span>Same Date</span>
      </Button>
      <Button className="detail-float-action h-auto" type="button" variant="ghost" onClick={() => onRunSimilarSearch(item)}>
        <SearchIcon data-icon="inline-start" />
        <span>Similar</span>
      </Button>
      {onConfirmAnswer ? (
        <Button className="detail-float-action detail-float-action--primary h-auto" type="button" onClick={() => onConfirmAnswer(item.id)}>
          <CheckIcon data-icon="inline-start" />
          <span>{confirmLabel}</span>
        </Button>
      ) : (
        <Button className="detail-float-action detail-float-action--primary h-auto" type="button" onClick={() => onSendSelection(item)}>
          <SendIcon data-icon="inline-start" />
          <span>Send</span>
        </Button>
      )}
    </div>
  );
}
