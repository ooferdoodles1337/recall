import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { HandIcon } from "lucide-react";
import { MOTION_EASE } from "./phoneUtils";

const HINT_AUTO_DISMISS_MS = 3000;

interface LongPressHintProps {
  visible: boolean;
  onDismiss: () => void;
}

export function LongPressHint({ visible, onDismiss }: LongPressHintProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, HINT_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="long-press-hint"
          role="status"
          aria-live="polite"
          aria-label="Tip: long press a photo to view it"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: MOTION_EASE.standard } }}
          exit={{ opacity: 0, y: 4, transition: { duration: 0.14, ease: MOTION_EASE.exit } }}
          onClick={onDismiss}
        >
          <HandIcon aria-hidden size={14} />
          <span>Long press to view</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
