import { ShieldAlertIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { RecallMediaItem } from "@/shared/types/recall";

interface HiddenDialogProps {
  item: RecallMediaItem;
  onKeepHidden: () => void;
  onViewItem: (item: RecallMediaItem) => void;
  onRevealAll: () => void;
}

export function HiddenDialog({ item, onKeepHidden, onViewItem, onRevealAll }: HiddenDialogProps) {
  const mediaType = item.metadata.asset?.media_type === "video" ? "video" : "photo";
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onKeepHidden(); }}>
      <SheetContent side="bottom" showCloseButton={false} className="hidden-sheet p-0">
        <div className="hidden-sheet-header">
          <div className="hidden-sheet-icon" aria-hidden>
            <ShieldAlertIcon />
          </div>
          <SheetTitle className="hidden-sheet-title">Hidden</SheetTitle>
          <SheetDescription className="hidden-sheet-body">
            This {mediaType} was flagged by automated review.
          </SheetDescription>
        </div>
        <div className="hidden-sheet-actions">
          <button className="hidden-sheet-btn hidden-sheet-btn--view" type="button" onClick={() => onViewItem(item)}>
            View
          </button>
          <button className="hidden-sheet-btn hidden-sheet-btn--cancel" type="button" onClick={onKeepHidden}>
            Keep Hidden
          </button>
          <div className="hidden-sheet-divider" aria-hidden />
          <button className="hidden-sheet-btn hidden-sheet-btn--reveal-all" type="button" onClick={onRevealAll}>
            Show all hidden for this session
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
