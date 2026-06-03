import { useCallback, useState } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isItemHidden } from "../phoneUtils";

export type HiddenApi = {
  isItemBlurred: (item: RecallMediaItem) => boolean;
  hiddenPendingItem: RecallMediaItem | null;
  setHiddenPendingItem: (item: RecallMediaItem | null) => void;
  revealOne: (id: string) => void;
  revealAll: () => void;
  revealSafe: (id: string) => void;
};

export function useHiddenReveal(): HiddenApi {
  const [hiddenRevealedIds, setHiddenRevealedIds] = useState<Set<string>>(new Set());
  const [hiddenRevealedAll, setHiddenRevealedAll] = useState(false);
  const [hiddenPendingItem, setHiddenPendingItem] = useState<RecallMediaItem | null>(null);

  const isItemBlurred = useCallback((item: RecallMediaItem) =>
    isItemHidden(item) && !hiddenRevealedAll && !hiddenRevealedIds.has(item.id),
  [hiddenRevealedAll, hiddenRevealedIds]);

  const revealOne = useCallback((id: string) => {
    setHiddenRevealedIds((prev) => new Set([...prev, id]));
    setHiddenPendingItem(null);
  }, []);

  const revealAll = useCallback(() => {
    setHiddenRevealedAll(true);
    setHiddenPendingItem(null);
  }, []);

  const revealSafe = useCallback((id: string) => {
    setHiddenRevealedIds((prev) => new Set([...prev, id]));
  }, []);

  return { isItemBlurred, hiddenPendingItem, setHiddenPendingItem, revealOne, revealAll, revealSafe };
}
