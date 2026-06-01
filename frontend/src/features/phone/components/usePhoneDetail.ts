import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { PhoneModeAction } from "../phoneReducer";
import { patchCatalogItem } from "../api/searchApi";
import { itemDateLabel } from "./phoneUtils";

export type DetailApi = {
  detailItem: RecallMediaItem | null;
  setDetailItem: (item: RecallMediaItem | null) => void;
  aboutSheetItem: RecallMediaItem | null;
  setAboutSheetItem: (item: RecallMediaItem | null) => void;
  openDetail: (item: RecallMediaItem) => void;
  closeDetail: () => void;
  handleToggleFavorite: (item: RecallMediaItem) => void;
  handleToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
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
  onItemUpdated?: (item: RecallMediaItem) => void;
};

type CatalogItemsCache = {
  count: number;
  results: RecallMediaItem[];
};

function replaceItem(items: RecallMediaItem[], updated: RecallMediaItem) {
  return items.map((item) => item.id === updated.id ? updated : item);
}

export function usePhoneDetail(deps: Dependencies): DetailApi {
  const {
    isItemBlurred, onSelectCandidate, modeRef, dispatch,
    setQuery, runSearch, setErrorMessage, setNsfwPendingItem, revealSafe,
    onItemUpdated,
  } = deps;
  const queryClient = useQueryClient();

  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);

  const publishUpdatedItem = useCallback((updated: RecallMediaItem) => {
    setDetailItem((prev) => prev?.id === updated.id ? updated : prev);
    setAboutSheetItem((prev) => prev?.id === updated.id ? updated : prev);
    queryClient.setQueriesData<CatalogItemsCache>({ queryKey: ["catalog"] }, (old) => {
      if (!old?.results) return old;
      return { ...old, results: replaceItem(old.results, updated) };
    });
    onItemUpdated?.(updated);
  }, [onItemUpdated, queryClient]);

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

  const { mutate: mutateFavorite } = useMutation({
    mutationFn: ({ item, favorite }: { item: RecallMediaItem; favorite: boolean }) =>
      patchCatalogItem(item.id, { organization: { favorite } }),
    onSuccess: (updated) => {
      publishUpdatedItem(updated);
      void queryClient.invalidateQueries({ queryKey: ["catalog", "favorites"] });
    },
    onError: () => setErrorMessage("Couldn't update favorite — please try again."),
  });

  const handleToggleFavorite = useCallback((item: RecallMediaItem) => {
    mutateFavorite({ item, favorite: !(item.metadata.organization?.favorite ?? false) });
  }, [mutateFavorite]);

  const { mutate: mutateSafety } = useMutation({
    mutationFn: ({ item, state }: { item: RecallMediaItem; state: "safe" | "nsfw" }) =>
      patchCatalogItem(item.id, { safety: { state } }),
    onSuccess: (updated, { item, state }) => {
      publishUpdatedItem(updated);
      if (state === "safe") { revealSafe(item.id); setNsfwPendingItem(null); }
    },
    onError: () => setErrorMessage("Couldn't update content rating — please try again."),
  });

  const handleToggleSafety = useCallback((item: RecallMediaItem, state: "safe" | "nsfw") => {
    mutateSafety({ item, state });
  }, [mutateSafety]);

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
