import { useCallback, useState } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";
import { patchCatalogItem } from "../api/searchApi";
import { itemDateLabel } from "./phoneUtils";

export type DetailApi = {
  detailItem: RecallMediaItem | null;
  setDetailItem: (item: RecallMediaItem | null) => void;
  aboutSheetItem: RecallMediaItem | null;
  setAboutSheetItem: (item: RecallMediaItem | null) => void;
  openDetail: (item: RecallMediaItem) => void;
  closeDetail: () => void;
  handleToggleFavorite: (item: RecallMediaItem) => Promise<void>;
  handleToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => Promise<void>;
  searchSameDate: (item: RecallMediaItem) => void;
};

type Dependencies = {
  isItemBlurred: (item: RecallMediaItem) => boolean;
  onSelectCandidate?: (id: string) => void;
  modeRef: React.MutableRefObject<string>;
  dispatch: (action: any) => void;
  favoriteItems: RecallMediaItem[];
  setFavoriteItems: React.Dispatch<React.SetStateAction<RecallMediaItem[]>>;
  setQuery: (q: string) => void;
  runSearch: (q: string) => void;
  setErrorMessage: (msg: string | null) => void;
  setNsfwPendingItem: (item: RecallMediaItem | null) => void;
  revealSafe: (id: string) => void;
};

export function usePhoneDetail(deps: Dependencies): DetailApi {
  const {
    isItemBlurred, onSelectCandidate, modeRef, dispatch,
    favoriteItems, setFavoriteItems, setQuery, runSearch,
    setErrorMessage, setNsfwPendingItem, revealSafe,
  } = deps;

  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);

  const openDetail = useCallback((item: RecallMediaItem) => {
    if (isItemBlurred(item)) { setNsfwPendingItem(item); return; }
    if (modeRef.current === "detail") return;
    dispatch({ type: "DETAIL_OPEN" });
    setDetailItem(item);
    onSelectCandidate?.(item.id);
  }, [isItemBlurred, modeRef, dispatch, onSelectCandidate, setNsfwPendingItem]);

  const closeDetail = useCallback(() => {
    dispatch({ type: "DETAIL_CLOSE" });
    setDetailItem(null);
  }, [dispatch]);

  const handleToggleFavorite = useCallback(async (item: RecallMediaItem) => {
    const current = item.metadata.organization?.favorite ?? false;
    const patch = { organization: { favorite: !current } };
    try {
      const updated = await patchCatalogItem(item.id, patch);
      setDetailItem((prev) => prev?.id === item.id ? updated : prev);
      const exists = favoriteItems.some((f) => f.id === item.id);
      if (exists && current) setFavoriteItems((prev) => prev.filter((f) => f.id !== item.id));
      else if (!exists && !current) setFavoriteItems((prev) => [updated, ...prev]);
      else setFavoriteItems((prev) => prev.map((f) => f.id === item.id ? updated : f));
    } catch { /* no-op */ }
  }, [favoriteItems, setFavoriteItems]);

  const handleToggleSafety = useCallback(async (item: RecallMediaItem, state: "safe" | "nsfw") => {
    const patch = { safety: { state } };
    try {
      const updated = await patchCatalogItem(item.id, patch);
      setDetailItem((prev) => prev?.id === item.id ? updated : prev);
      if (state === "safe") { revealSafe(item.id); setNsfwPendingItem(null); }
    } catch { /* no-op */ }
  }, [revealSafe, setNsfwPendingItem]);

  const searchSameDate = useCallback((item: RecallMediaItem) => {
    const date = itemDateLabel(item);
    if (!date) {
      setErrorMessage("This item has no date metadata yet.");
      setDetailItem(null);
      dispatch({ type: "SEARCH_COMMIT" });
      return;
    }
    setQuery(date);
    runSearch(date);
    setDetailItem(null);
  }, [dispatch, runSearch, setErrorMessage, setQuery]);

  return { detailItem, setDetailItem, aboutSheetItem, setAboutSheetItem, openDetail, closeDetail, handleToggleFavorite, handleToggleSafety, searchSameDate };
}