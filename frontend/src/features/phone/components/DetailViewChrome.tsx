import type React from "react";
import { motion } from "motion/react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  InfoIcon,
  MoreHorizontalIcon,
  SearchIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  StarIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecallMediaItem } from "@/shared/types/recall";
import { itemDateLabel, itemTitle, MOTION_EASE, PHONE_MOTION } from "./phoneUtils";
import { SensitiveDetailPrompt } from "./SensitiveDetailPrompt";

export type DetailGestureHandlers = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onPointerDown" | "onPointerUp" | "onPointerCancel" | "onTouchStart" | "onTouchEnd" | "onTouchCancel"
>;

type DetailScreenProps = {
  children: React.ReactNode;
  className?: string;
  controls?: React.ReactNode;
  gestureHandlers?: DetailGestureHandlers;
  isSensitiveHidden?: boolean;
  item: RecallMediaItem;
  layoutId?: string;
  mediaClassName?: string;
  navigationDirection?: -1 | 0 | 1;
  onBack: () => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  onRevealSensitive?: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
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
  initial: (direction: -1 | 0 | 1) => ({
    opacity: direction === 0 ? 0 : 0.86,
    x: direction === 0 ? 0 : direction * 48,
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.22, ease: MOTION_EASE.gentle },
  },
  exit: (direction: -1 | 0 | 1) => ({
    opacity: direction === 0 ? 0 : 0.82,
    x: direction === 0 ? 0 : direction * -48,
    transition: { duration: direction === 0 ? 0.16 : 0.18, ease: MOTION_EASE.exit },
  }),
};

export function DetailScreen({
  children,
  className = "",
  controls,
  gestureHandlers,
  isSensitiveHidden = false,
  item,
  layoutId,
  mediaClassName = "",
  navigationDirection = 0,
  onBack,
  onOpenAbout,
  onRevealSensitive,
  onToggleFavorite,
  onToggleSafety,
  topBarClassName,
}: DetailScreenProps) {
  return (
    <motion.div
      className={`detail-screen phone-detail-motion${className ? ` ${className}` : ""}${isSensitiveHidden ? " detail-screen--sensitive-hidden" : ""}`}
      aria-label={`${itemTitle(item)} detail view`}
      variants={detailBackdropMotion}
      custom={navigationDirection}
      initial="initial"
      animate="animate"
      exit="exit"
      {...gestureHandlers}
    >
      <motion.div
        className={`detail-media-fill phone-detail-media-motion${mediaClassName ? ` ${mediaClassName}` : ""}${isSensitiveHidden ? " detail-media-fill--sensitive-hidden" : ""}`}
        layoutId={layoutId}
        transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
      >
        {children}
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
            aria-label={item.metadata.organization?.favorite ? "Remove from favorites" : "Add to favorites"}
          >
            {item.metadata.organization?.favorite ? <StarIcon fill="currentColor" /> : <StarIcon />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="detail-float-btn" type="button" variant="ghost" size="icon-sm" aria-label="More actions">
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
