import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isFavorite } from "@/shared/media/mediaItem";
import type { PhoneModeAction } from "../phoneReducer";
import { patchCatalogItem } from "../api/searchApi";
import { datePrefixForItem, formatDatePrefix } from "../phoneUtils";
import { phoneQueryKeys } from "../model/queryKeys";

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
  runDateBrowse: (datePrefix: string, label: string) => void;
  setErrorMessage: (msg: string | null) => void;
  setHiddenPendingItem: (item: RecallMediaItem | null) => void;
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
    runDateBrowse, setErrorMessage, setHiddenPendingItem, revealSafe,
    onItemUpdated,
  } = deps;
  const queryClient = useQueryClient();

  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [aboutSheetItem, setAboutSheetItem] = useState<RecallMediaItem | null>(null);

  const publishUpdatedItem = useCallback((updated: RecallMediaItem) => {
    setDetailItem((prev) => prev?.id === updated.id ? updated : prev);
    setAboutSheetItem((prev) => prev?.id === updated.id ? updated : prev);
    queryClient.setQueriesData<CatalogItemsCache>({ queryKey: phoneQueryKeys.catalog() }, (old) => {
      if (!old?.results) return old;
      return { ...old, results: replaceItem(old.results, updated) };
    });
    onItemUpdated?.(updated);
  }, [onItemUpdated, queryClient]);

  const openDetail = useCallback((item: RecallMediaItem) => {
    if (isItemBlurred(item)) { setHiddenPendingItem(item); return; }
    if (modeRef.current === "detail") return;
    dispatch({ type: "DETAIL_OPEN" });
    setDetailItem(item);
    onSelectCandidate?.(item.id);
  }, [isItemBlurred, modeRef, dispatch, onSelectCandidate, setHiddenPendingItem]);

  const closeDetail = useCallback(() => {
    dispatch({ type: "DETAIL_CLOSE" });
    setDetailItem(null);
  }, [dispatch]);

  const { mutate: mutateFavorite } = useMutation({
    mutationFn: ({ item, favorite }: { item: RecallMediaItem; favorite: boolean }) =>
      patchCatalogItem(item.id, { organization: { favorite } }),
    onSuccess: (updated) => {
      publishUpdatedItem(updated);
      void queryClient.invalidateQueries({ queryKey: phoneQueryKeys.favoritesAll() });
    },
    onError: () => setErrorMessage("Couldn't update favorite — please try again."),
  });

  const handleToggleFavorite = useCallback((item: RecallMediaItem) => {
    mutateFavorite({ item, favorite: !isFavorite(item) });
  }, [mutateFavorite]);

  const { mutate: mutateSafety } = useMutation({
    mutationFn: ({ item, state }: { item: RecallMediaItem; state: "safe" | "nsfw" }) =>
      patchCatalogItem(item.id, { safety: { state } }),
    onSuccess: (updated, { item, state }) => {
      publishUpdatedItem(updated);
      if (state === "safe") { revealSafe(item.id); setHiddenPendingItem(null); }
    },
    onError: () => setErrorMessage("Couldn't update content rating — please try again."),
  });

  const handleToggleSafety = useCallback((item: RecallMediaItem, state: "safe" | "nsfw") => {
    mutateSafety({ item, state });
  }, [mutateSafety]);

  const searchSameDate = useCallback((item: RecallMediaItem) => {
    const datePrefix = datePrefixForItem(item);
    if (!datePrefix) {
      setErrorMessage("This item has no date metadata yet.");
      return;
    }
    const label = datePrefix.length === 7 ? `All of ${formatDatePrefix(datePrefix)}` : formatDatePrefix(datePrefix);
    runDateBrowse(datePrefix, label);
    setDetailItem(null);
  }, [runDateBrowse, setErrorMessage]);

  return { detailItem, setDetailItem, aboutSheetItem, setAboutSheetItem, openDetail, closeDetail, handleToggleFavorite, handleToggleSafety, searchSameDate };
}
