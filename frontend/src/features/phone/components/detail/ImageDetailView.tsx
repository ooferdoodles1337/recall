import type { RecallMediaItem } from "@/shared/types/recall";
import { resolvedMediaUrl } from "@/shared/media/mediaItem";
import { itemTitle } from "../../phoneUtils";
import { DetailActionRow, DetailScreen, type DetailNeighborPreview } from "./DetailViewChrome";

interface ImageDetailViewProps {
  item: RecallMediaItem;
  canNavigateNext?: boolean;
  canNavigatePrevious?: boolean;
  isSensitiveHidden?: boolean;
  onRevealSensitive?: (item: RecallMediaItem) => void;
  onBack: () => void;
  onNavigate?: (direction: 1 | -1) => void;
  onSearchSameDate: (item: RecallMediaItem) => void;
  onRunSimilarSearch: (item: RecallMediaItem) => void;
  onConfirmAnswer?: (id: string) => void;
  onSendSelection: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  layoutId?: string;
  navigationDirection?: -1 | 0 | 1;
  nextPreview?: DetailNeighborPreview | null;
  previousPreview?: DetailNeighborPreview | null;
}

export function ImageDetailView({
  item,
  canNavigateNext = false,
  canNavigatePrevious = false,
  isSensitiveHidden = false,
  onRevealSensitive,
  onBack,
  onNavigate,
  onSearchSameDate,
  onRunSimilarSearch,
  onConfirmAnswer,
  onSendSelection,
  onToggleFavorite,
  onToggleSafety,
  onOpenAbout,
  layoutId,
  navigationDirection = 0,
  nextPreview = null,
  previousPreview = null,
}: ImageDetailViewProps) {
  return (
    <DetailScreen
      item={item}
      canNavigateNext={canNavigateNext}
      canNavigatePrevious={canNavigatePrevious}
      isSensitiveHidden={isSensitiveHidden}
      onRevealSensitive={onRevealSensitive}
      onBack={onBack}
      onNavigate={onNavigate}
      onOpenAbout={onOpenAbout}
      onToggleFavorite={onToggleFavorite}
      onToggleSafety={onToggleSafety}
      layoutId={layoutId}
      navigationDirection={navigationDirection}
      nextPreview={nextPreview}
      previousPreview={previousPreview}
      controls={
        <DetailActionRow
          className="detail-float-bottom"
          role="group"
          ariaLabel="Detail actions"
          item={item}
          onSearchSameDate={onSearchSameDate}
          onRunSimilarSearch={onRunSimilarSearch}
          onConfirmAnswer={onConfirmAnswer}
          onSendSelection={onSendSelection}
        />
      }
    >
      <img src={resolvedMediaUrl(item) ?? item.links?.media ?? item.links?.thumbnail} alt={itemTitle(item)} onContextMenu={(e) => e.preventDefault()} />
    </DetailScreen>
  );
}
