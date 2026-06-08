import { EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecallMediaItem } from "@/shared/types/recall";

interface SensitiveDetailPromptProps {
  item: RecallMediaItem;
  onView: (item: RecallMediaItem) => void;
}

export function SensitiveDetailPrompt({ item, onView }: SensitiveDetailPromptProps) {
  return (
    <div className="detail-sensitive-prompt" aria-live="polite">
      <div className="detail-sensitive-card">
        <EyeOffIcon className="detail-sensitive-icon" aria-hidden />
        <h2 className="detail-sensitive-title">Hidden</h2>
        <p className="detail-sensitive-body">
          This item is hidden until you choose to view it.
        </p>
        <Button
          className="detail-sensitive-view h-auto"
          type="button"
          onClick={() => onView(item)}
        >
          View
        </Button>
      </div>
    </div>
  );
}
