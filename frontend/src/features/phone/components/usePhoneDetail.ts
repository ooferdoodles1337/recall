import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { PhoneModeAction } from "../phoneReducer";
import { patchCatalogItem } from "../api/searchApi";
import { itemDateLabel, FAVORITES_COUNT } from "./phoneUtils";

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
  dispatch: (action: PhoneModeAction) => void;
  setQuery: (q: string) => void;
  runSearch: (q: string) => void;
  setErrorMessage: (msg: string | null) => void;
  setNsfwPendingItem: (item: RecallMediaItem | null) => void;
  revealSafe: (id: string) => void;
};

export function usePhoneDetail(deps: Dependencies): DetailApi {
  const {
    isItemBlurred, onSelectCandidate, modeRef, dispatch,
    setQuery, runSearch, setErrorMessage, setNsfwPendingItem, revealSafe,
  } = deps;
  const queryClient = useQueryClient();

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
      queryClient.setQueryData(
        ["catalog", "favorites", FAVORITES_COUNT],
        (old: { count: number; results: RecallMediaItem[] } | undefined) => {
          if (!old) return old;
          const exists = old.results.some((f) => f.id === item.id);
          let results: RecallMediaItem[];
          if (exists && current) results = old.results.filter((f) => f.id !== item.id);
          else if (!exists && !current) results = [updated, ...old.results];
          else results = old.results.map((f) => f.id === item.id ? updated : f);
          return { ...old, results };
        },
      );
    } catch {
      setErrorMessage("Couldn't update favorite — please try again.");
    }
  }, [queryClient, setErrorMessage]);

  const handleToggleSafety = useCallback(async (item: RecallMediaItem, state: "safe" | "nsfw") => {
    const patch = { safety: { state } };
    try {
      const updated = await patchCatalogItem(item.id, patch);
      setDetailItem((prev) => prev?.id === item.id ? updated : prev);
      if (state === "safe") { revealSafe(item.id); setNsfwPendingItem(null); }
    } catch {
      setErrorMessage("Couldn't update content rating — please try again.");
    }
  }, [revealSafe, setNsfwPendingItem, setErrorMessage]);

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