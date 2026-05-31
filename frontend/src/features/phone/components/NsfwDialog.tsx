import { ShieldAlertIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
    <AlertDialog open onOpenChange={(open) => { if (!open) onKeepHidden(); }}>
      <AlertDialogContent className="nsfw-sheet p-0 gap-0">
        <AlertDialogHeader className="nsfw-sheet-header block">
          <AlertDialogMedia className="nsfw-sheet-icon bg-transparent p-0" aria-hidden>
            <ShieldAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle className="sr-only">Sensitive content warning</AlertDialogTitle>
          <p className="nsfw-sheet-title">Sensitive Content</p>
          <AlertDialogDescription className="nsfw-sheet-body">
            This {mediaType} was flagged as potentially inappropriate.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="nsfw-sheet-actions">
          <AlertDialogAction className="nsfw-sheet-btn nsfw-sheet-btn--reveal-all h-auto" onClick={onRevealAll}>
            Reveal for Session
          </AlertDialogAction>
          <AlertDialogAction className="nsfw-sheet-btn nsfw-sheet-btn--reveal-one h-auto" onClick={() => onRevealOne(item.id)}>
            Reveal This One
          </AlertDialogAction>
          <AlertDialogAction className="nsfw-sheet-btn nsfw-sheet-btn--mark-safe h-auto" onClick={() => onMarkSafe(item)}>
            Mark as Safe
          </AlertDialogAction>
          <AlertDialogCancel className="nsfw-sheet-btn nsfw-sheet-btn--cancel h-auto" onClick={onKeepHidden}>
            Keep Hidden
          </AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
