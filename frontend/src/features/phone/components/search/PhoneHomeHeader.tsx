import { motion } from "motion/react";
import { SearchIcon, Settings2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOTION_EASE } from "../../phoneUtils";

interface PhoneHomeHeaderProps {
  onExit?: () => void;
  onOpenSettings?: () => void;
}

export function PhoneHomeHeader({ onExit, onOpenSettings }: PhoneHomeHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: MOTION_EASE.standard }}
    >
      <div className="phone-startpage-header">
        <div className="phone-startpage-brand">
          <div className="phone-startpage-logo" aria-hidden>
            <SearchIcon />
          </div>
          <h1 className="phone-startpage-title">Recall</h1>
        </div>
        <div className="phone-startpage-actions">
          <button
            type="button"
            className="phone-avatar-btn"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <Settings2Icon className="phone-settings-icon" aria-hidden />
          </button>
          {onExit ? (
            <Button
              className="phone-exit-btn"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onExit}
              aria-label="Exit phone tester"
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}