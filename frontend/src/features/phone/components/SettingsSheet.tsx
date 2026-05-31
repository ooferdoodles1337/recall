import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronRightIcon, FolderIcon, Grid3x3Icon, InfoIcon, ShieldIcon, UserIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";

interface SettingsSheetProps {
  onClose: () => void;
  indexedAlbumCount: number;
  indexedAlbumTotal: number;
  gridColumns: number;
  onOpenIndexedAlbums: () => void;
  escapeDisabled?: boolean;
}

/**
 * Mock Settings sheet (UX spec ST-2/ST-3).
 *
 * Opened from the home-header avatar. A plausible grouped iOS settings menu so
 * the Indexed Albums picker isn't the only thing behind the profile. Only
 * "Indexed Albums" navigates; the rest are cosmetic mock controls (ST-6).
 */
export function SettingsSheet({
  onClose,
  indexedAlbumCount,
  indexedAlbumTotal,
  gridColumns,
  onOpenIndexedAlbums,
  escapeDisabled = false,
}: SettingsSheetProps) {
  // Cosmetic-only toggle — not persisted, changes no real behavior.
  const [showSensitive, setShowSensitive] = useState(false);

  useEffect(() => {
    if (escapeDisabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [escapeDisabled, onClose]);

  return (
    <motion.div
      className="about-backdrop"
      role="dialog"
      aria-modal
      aria-label="Settings"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="about-sheet about-sheet--full"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="about-sheet-header settings-sheet-header">
          <span className="settings-sheet-header-title">Settings</span>
          <button
            className="about-sheet-done"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            Done
          </button>
        </div>

        <div className="about-sheet-scroll">
          <section className="settings-group">
            <div className="settings-account">
              <Avatar className="settings-account-avatar" aria-hidden>
                <AvatarFallback>
                  <UserIcon />
                </AvatarFallback>
              </Avatar>
              <div className="settings-account-text">
                <span className="settings-account-name">Test Participant</span>
                <span className="settings-account-email">tester@recall.app</span>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group-title">Search &amp; Indexing</h3>
            <div className="settings-rows">
              <button type="button" className="settings-row settings-row--nav" onClick={onOpenIndexedAlbums}>
                <FolderIcon className="settings-row-icon" aria-hidden />
                <span className="settings-row-label">Indexed Albums</span>
                <span className="settings-row-value">
                  {indexedAlbumCount} of {indexedAlbumTotal}
                </span>
                <ChevronRightIcon className="settings-row-chevron" aria-hidden />
              </button>

              <div className="settings-row">
                <ShieldIcon className="settings-row-icon" aria-hidden />
                <label className="settings-row-label" htmlFor="settings-show-sensitive">
                  Show sensitive results
                </label>
                <Switch
                  id="settings-show-sensitive"
                  checked={showSensitive}
                  onCheckedChange={setShowSensitive}
                />
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group-title">Appearance</h3>
            <div className="settings-rows">
              <div className="settings-row">
                <Grid3x3Icon className="settings-row-icon" aria-hidden />
                <span className="settings-row-label">Default grid density</span>
                <span className="settings-row-value">{gridColumns} columns</span>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group-title">About</h3>
            <div className="settings-rows">
              <div className="settings-row">
                <InfoIcon className="settings-row-icon" aria-hidden />
                <span className="settings-row-label">Recall</span>
                <span className="settings-row-value">Version 1.0</span>
              </div>
            </div>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}
