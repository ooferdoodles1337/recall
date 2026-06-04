import { useState } from "react";
import { ChevronRightIcon, ClockIcon, FolderIcon, InfoIcon, ShieldIcon, UserIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { HomeFeed } from "../../model/homeFeed";

interface SettingsSheetProps {
  onClose: () => void;
  indexedAlbumCount: number;
  indexedAlbumTotal: number;
  defaultHomeFeed: HomeFeed;
  onChangeDefaultHomeFeed: (feed: HomeFeed) => void;
  onOpenIndexedAlbums: () => void;
  onRevealAll?: () => void;
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
  defaultHomeFeed,
  onChangeDefaultHomeFeed,
  onOpenIndexedAlbums,
  onRevealAll,
  escapeDisabled = false,
}: SettingsSheetProps) {
  const [showSensitive, setShowSensitive] = useState(false);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="about-sheet about-sheet--full"
        onEscapeKeyDown={(event) => {
          if (escapeDisabled) event.preventDefault();
        }}
      >
        <div className="about-sheet-header settings-sheet-header">
          <SheetTitle className="settings-sheet-header-title">Settings</SheetTitle>
          <SheetClose asChild>
            <button className="about-sheet-done" type="button">
              Done
            </button>
          </SheetClose>
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
                <ClockIcon className="settings-row-icon" aria-hidden />
                <span className="settings-row-label" id="settings-home-feed-label">
                  Home shows
                </span>
                <div
                  className="settings-segmented"
                  role="radiogroup"
                  aria-labelledby="settings-home-feed-label"
                >
                  {(["recents", "favorites"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={defaultHomeFeed === option}
                      className="settings-segment"
                      data-active={defaultHomeFeed === option}
                      onClick={() => onChangeDefaultHomeFeed(option)}
                    >
                      {option === "recents" ? "Recents" : "Favorites"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <ShieldIcon className="settings-row-icon" aria-hidden />
                <label className="settings-row-label" htmlFor="settings-show-sensitive">
                  Show hidden results
                </label>
                <Switch
                  id="settings-show-sensitive"
                  checked={showSensitive}
                  onCheckedChange={(checked) => {
                    setShowSensitive(checked);
                    if (checked) onRevealAll?.();
                  }}
                />
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
      </SheetContent>
    </Sheet>
  );
}
