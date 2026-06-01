import type { RecallMediaItem } from "@/shared/types/recall";
import { resolvedMediaUrl } from "@/shared/media/mediaItem";
import { itemTitle } from "./phoneUtils";
import { DetailActionRow, DetailScreen, type DetailGestureHandlers } from "./DetailViewChrome";

interface ImageDetailViewProps {
  item: RecallMediaItem;
  gestureHandlers?: DetailGestureHandlers;
  isSensitiveHidden?: boolean;
  onRevealSensitive?: (item: RecallMediaItem) => void;
  onBack: () => void;
  onSearchSameDate: (item: RecallMediaItem) => void;
  onRunSimilarSearch: (item: RecallMediaItem) => void;
  onConfirmAnswer?: (id: string) => void;
  onSendSelection: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  layoutId?: string;
  navigationDirection?: -1 | 0 | 1;
}

export function ImageDetailView({
  item,
  gestureHandlers,
  isSensitiveHidden = false,
  onRevealSensitive,
  onBack,
  onSearchSameDate,
  onRunSimilarSearch,
  onConfirmAnswer,
  onSendSelection,
  onToggleFavorite,
  onToggleSafety,
  onOpenAbout,
  layoutId,
  navigationDirection = 0,
}: ImageDetailViewProps) {
  return (
    <DetailScreen
      item={item}
      gestureHandlers={gestureHandlers}
      isSensitiveHidden={isSensitiveHidden}
      onRevealSensitive={onRevealSensitive}
      onBack={onBack}
      onOpenAbout={onOpenAbout}
      onToggleFavorite={onToggleFavorite}
      onToggleSafety={onToggleSafety}
      layoutId={layoutId}
      navigationDirection={navigationDirection}
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
