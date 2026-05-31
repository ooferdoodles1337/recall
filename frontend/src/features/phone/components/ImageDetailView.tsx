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
import { resolvedMediaUrl } from "@/shared/media/mediaItem";
import { itemTitle, itemDateLabel, PHONE_MOTION, MOTION_EASE } from "./phoneUtils";

interface ImageDetailViewProps {
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

const detailBackdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: MOTION_EASE.standard } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: MOTION_EASE.exit } },
};

export function ImageDetailView({
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
}: ImageDetailViewProps) {
  return (
    <motion.div
      key={item.id}
      className="detail-screen phone-detail-motion"
      aria-label={`${itemTitle(item)} detail view`}
      variants={detailBackdropMotion}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="detail-media-fill phone-detail-media-motion"
        layoutId={layoutId}
        transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
      >
        <img src={resolvedMediaUrl(item) ?? item.links?.media ?? item.links?.thumbnail} alt={itemTitle(item)} onContextMenu={(e) => e.preventDefault()} />
      </motion.div>

      <div className="detail-float-top">
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

      <div className="detail-float-bottom" role="group" aria-label="Detail actions">
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
            <span>Send</span>
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
    </motion.div>
  );
}