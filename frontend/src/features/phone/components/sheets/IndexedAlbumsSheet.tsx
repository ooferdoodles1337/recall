import { useCallback, useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { MOCK_ALBUMS, albumThumbnailUrl } from "../../phoneUtils";

interface IndexedAlbumsSheetProps {
  initialSelectedIds: string[];
  onCancel: () => void;
  onSave: (ids: string[]) => void;
}

/**
 * Mock "Indexed Albums" picker (UX spec ST-4).
 *
 * Full-height glass sheet with a 3-column album grid and a Cancel/Save footer.
 * Selection lives in a local draft; Save commits it (to localStorage via the
 * parent), Cancel/backdrop/Escape discards. Presentational only (ST-6).
 */
export function IndexedAlbumsSheet({ initialSelectedIds, onCancel, onSave }: IndexedAlbumsSheetProps) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(initialSelectedIds));

  const toggle = useCallback((id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    onSave(MOCK_ALBUMS.filter((album) => draft.has(album.id)).map((album) => album.id));
  }, [draft, onSave]);

  const selectedCount = draft.size;
  const dirty = useMemo(() => {
    const initial = new Set(initialSelectedIds);
    if (initial.size !== draft.size) return true;
    for (const id of draft) if (!initial.has(id)) return true;
    return false;
  }, [draft, initialSelectedIds]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="about-sheet about-sheet--full"
      >
        <div className="settings-sheet-titlebar">
          <SheetTitle className="settings-sheet-title">Indexed Albums</SheetTitle>
          <SheetDescription className="settings-sheet-subtitle">
            Select the albums you want to be indexed
          </SheetDescription>
        </div>

        <div className="about-sheet-scroll album-picker-scroll">
          <div className="album-picker-grid" role="group" aria-label="Albums">
            {MOCK_ALBUMS.map((album) => {
              const selected = draft.has(album.id);
              return (
                <button
                  key={album.id}
                  type="button"
                  className={`album-card${selected ? " album-card--selected" : ""}`}
                  aria-pressed={selected}
                  aria-label={`${album.name}${selected ? ", indexed" : ", not indexed"}`}
                  onClick={() => toggle(album.id)}
                >
                  <span className="album-card-thumb">
                    <img
                      src={albumThumbnailUrl(album.thumbnailSeed)}
                      alt=""
                      loading="lazy"
                      width={120}
                      height={120}
                    />
                    <span className="album-card-check" aria-hidden>
                      {selected ? <CheckIcon /> : null}
                    </span>
                  </span>
                  <span className="album-card-label">{album.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="album-picker-footer">
          <SheetClose asChild>
            <button type="button" className="album-picker-btn album-picker-btn--cancel">
              Cancel
            </button>
          </SheetClose>
          <button
            type="button"
            className="album-picker-btn album-picker-btn--save"
            onClick={handleSave}
            disabled={!dirty}
          >
            Save{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
