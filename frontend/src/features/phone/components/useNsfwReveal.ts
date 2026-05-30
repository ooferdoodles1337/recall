import { useCallback, useState } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";
import { isItemNsfw } from "./phoneUtils";

export type NsfwApi = {
  isItemBlurred: (item: RecallMediaItem) => boolean;
  nsfwPendingItem: RecallMediaItem | null;
  setNsfwPendingItem: (item: RecallMediaItem | null) => void;
  revealOne: (id: string) => void;
  revealAll: () => void;
  revealSafe: (id: string) => void;
};

export function useNsfwReveal(): NsfwApi {
  const [nsfwRevealedIds, setNsfwRevealedIds] = useState<Set<string>>(new Set());
  const [nsfwRevealedAll, setNsfwRevealedAll] = useState(false);
  const [nsfwPendingItem, setNsfwPendingItem] = useState<RecallMediaItem | null>(null);

  const isItemBlurred = useCallback((item: RecallMediaItem) =>
    isItemNsfw(item) && !nsfwRevealedAll && !nsfwRevealedIds.has(item.id),
  [nsfwRevealedAll, nsfwRevealedIds]);

  const revealOne = useCallback((id: string) => {
    setNsfwRevealedIds((prev) => new Set([...prev, id]));
    setNsfwPendingItem(null);
  }, []);

  const revealAll = useCallback(() => {
    setNsfwRevealedAll(true);
    setNsfwPendingItem(null);
  }, []);

  const revealSafe = useCallback((id: string) => {
    setNsfwRevealedIds((prev) => new Set([...prev, id]));
  }, []);

  return { isItemBlurred, nsfwPendingItem, setNsfwPendingItem, revealOne, revealAll, revealSafe };
}