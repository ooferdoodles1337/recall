import { AnimatePresence, motion } from "motion/react";
import { SendIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RecallMediaItem } from "@/shared/types/recall";
import { resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import { itemTitle, MOTION_EASE } from "./phoneUtils";

interface SelectionTrayProps {
  selectedItems: RecallMediaItem[];
  toggleSelected: (item: RecallMediaItem) => void;
  onConfirmAnswer?: (id: string) => void;
  onClearSelection?: () => void;
}

export function SelectionTray({ selectedItems, toggleSelected, onConfirmAnswer, onClearSelection }: SelectionTrayProps) {
  return (
    <AnimatePresence initial={false}>
      {selectedItems.length > 0 ? (
        <motion.div
          className="selection-tray"
          role="region"
          aria-label="Selection tray"
          aria-live="polite"
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.985 }}
          transition={{ duration: 0.22, ease: MOTION_EASE.gentle }}
        >
          <div className="selection-tray-content">
            <div className="selection-thumbs" aria-label="Selected items">
              {selectedItems.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  className="selection-thumb-btn h-auto"
                  onClick={() => toggleSelected(item)}
                  aria-label={`Remove ${itemTitle(item)} from selection`}
                >
                  <span className="selection-thumb-x" aria-hidden>
                    <XIcon />
                  </span>
                  <img src={resolvedThumbnailUrl(item) ?? item.links?.thumbnail ?? item.links?.media} alt="" loading="lazy" decoding="async" />
                </Button>
              ))}
            </div>
            <div className="selection-tray-actions">
              <Badge variant="secondary" className="selection-count">{selectedItems.length} selected</Badge>
              <Button
                className="send-btn h-auto"
                type="button"
                onClick={() => {
                  if (onConfirmAnswer && selectedItems.length > 0) {
                    onConfirmAnswer(selectedItems[0].id);
                  }
                  onClearSelection?.();
                }}
              >
                <SendIcon data-icon="inline-start" />
                Send
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}