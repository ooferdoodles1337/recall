import { ShieldAlertIcon } from "lucide-react";
import type { RecallMediaItem } from "@/shared/types/recall";

interface NsfwDialogProps {
  item: RecallMediaItem;
  onKeepHidden: () => void;
  onRevealOne: (id: string) => void;
  onRevealAll: () => void;
  onMarkSafe: (item: RecallMediaItem) => void;
}

export function NsfwDialog({ item, onKeepHidden, onRevealOne, onRevealAll, onMarkSafe }: NsfwDialogProps) {
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