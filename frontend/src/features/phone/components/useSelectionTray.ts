import { useCallback, useRef } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";

export type SelectionApi = {
  selectedItems: RecallMediaItem[];
  toggleSelected: (item: RecallMediaItem) => void;
  sendSelection: (item?: RecallMediaItem) => RecallMediaItem[];
  clearSelection: () => void;
  selectedItemsRef: React.MutableRefObject<RecallMediaItem[]>;
};

export function useSelectionTray(
  selectedItems: RecallMediaItem[],
  setSelectedItems: React.Dispatch<React.SetStateAction<RecallMediaItem[]>>,
): SelectionApi {
  const selectedItemsRef = useRef(selectedItems);
  selectedItemsRef.current = selectedItems;

  const toggleSelected = useCallback((item: RecallMediaItem) => {
    setSelectedItems((existing) => {
      if (existing.some((c) => c.id === item.id)) return existing.filter((c) => c.id !== item.id);
      return [...existing, item];
    });
  }, [setSelectedItems]);

  const sendSelection = useCallback((item?: RecallMediaItem): RecallMediaItem[] => {
    const next = item && !selectedItemsRef.current.some((c) => c.id === item.id)
      ? [...selectedItemsRef.current, item]
      : selectedItemsRef.current;
    return next;
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems([]);
  }, [setSelectedItems]);

  return { selectedItems, toggleSelected, sendSelection, clearSelection, selectedItemsRef };
}