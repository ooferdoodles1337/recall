import { useCallback, useState } from "react";
import { MOCK_ALBUMS, readIndexedAlbums, writeIndexedAlbums } from "../phoneUtils";

/**
 * Committed state for the mock "Indexed Albums" picker (UX spec ST-5).
 *
 * Holds the saved selection (persisted to localStorage) and exposes `save` for
 * the picker to commit a draft. Purely presentational — nothing else in the app
 * reads this value (ST-6).
 */
export function useIndexedAlbums() {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => readIndexedAlbums());

  const save = useCallback((ids: string[]) => {
    writeIndexedAlbums(ids);
    setSelectedIds(readIndexedAlbums());
  }, []);

  return {
    selectedIds,
    count: selectedIds.length,
    total: MOCK_ALBUMS.length,
    save,
  };
}
