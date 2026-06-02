import { ShieldAlertIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { RecallMediaItem } from "@/shared/types/recall";

interface NsfwDialogProps {
  item: RecallMediaItem;
  onKeepHidden: () => void;
  onViewItem: (item: RecallMediaItem) => void;
  onRevealAll: () => void;
}

export function NsfwDialog({ item, onKeepHidden, onViewItem, onRevealAll }: NsfwDialogProps) {
  const mediaType = item.metadata.asset?.media_type === "video" ? "video" : "photo";
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onKeepHidden(); }}>
      <SheetContent side="bottom" showCloseButton={false} className="nsfw-sheet p-0">
        <div className="nsfw-sheet-header">
          <div className="nsfw-sheet-icon" aria-hidden>
            <ShieldAlertIcon />
          </div>
          <SheetTitle className="nsfw-sheet-title">Sensitive Content</SheetTitle>
          <SheetDescription className="nsfw-sheet-body">
            This {mediaType} was flagged by automated review.
          </SheetDescription>
        </div>
        <div className="nsfw-sheet-actions">
          <button className="nsfw-sheet-btn nsfw-sheet-btn--view" type="button" onClick={() => onViewItem(item)}>
            View
          </button>
          <button className="nsfw-sheet-btn nsfw-sheet-btn--cancel" type="button" onClick={onKeepHidden}>
            Keep Hidden
          </button>
          <div className="nsfw-sheet-divider" aria-hidden />
          <button className="nsfw-sheet-btn nsfw-sheet-btn--reveal-all" type="button" onClick={onRevealAll}>
            Show all sensitive for this session
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
