import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { PhoneScreen } from "../phoneReducer";
import {
  LONG_PRESS_CANCEL_DIST_SQ,
  LONG_PRESS_MS,
  readLongPressHintDismissed,
  SELECTION_SUPPRESS_MS,
  writeLongPressHintDismissed,
} from "../phoneUtils";
import { useSelectionTray } from "./useSelectionTray";

interface UseMediaGridSelectionOptions {
  isItemBlurred: (item: RecallMediaItem) => boolean;
  modeRef: MutableRefObject<PhoneScreen>;
  onOpenDetail: (item: RecallMediaItem) => void;
  onReviewHiddenItem: (item: RecallMediaItem | null) => void;
  selectedItems: RecallMediaItem[];
  setSelectedItems: Dispatch<SetStateAction<RecallMediaItem[]>>;
}

export function useMediaGridSelection({
  isItemBlurred,
  modeRef,
  onOpenDetail,
  onReviewHiddenItem,
  selectedItems,
  setSelectedItems,
}: UseMediaGridSelectionOptions) {
  const [showLongPressHint, setShowLongPressHint] = useState(false);
  const hasShownHintRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSelectionUntilRef = useRef(0);
  const { toggleSelected } = useSelectionTray(selectedItems, setSelectedItems);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerDownPosRef.current = null;
  }, []);

  const suppressTileSelectionBriefly = useCallback(() => {
    suppressSelectionUntilRef.current = (typeof window !== "undefined" ? window.performance.now() : Date.now()) + SELECTION_SUPPRESS_MS;
  }, []);

  const isTileSelectionSuppressed = useCallback(() => {
    return (typeof window !== "undefined" ? window.performance.now() : Date.now()) < suppressSelectionUntilRef.current;
  }, []);

  const handleItemPointerDown = useCallback((e: ReactPointerEvent, item: RecallMediaItem) => {
    e.stopPropagation();
    if (isTileSelectionSuppressed()) {
      cancelLongPress();
      return;
    }
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    if (!isItemBlurred(item)) {
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        longPressTimerRef.current = null;
        onOpenDetail(item);
      }, LONG_PRESS_MS);
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, onOpenDetail]);

  const handleItemPointerUp = useCallback((_e: ReactPointerEvent, item: RecallMediaItem) => {
    cancelLongPress();
    if (isTileSelectionSuppressed()) return;
    if (!longPressTriggeredRef.current) {
      if (isItemBlurred(item)) {
        onReviewHiddenItem(item);
      } else {
        toggleSelected(item);
        if (modeRef.current === "results" && !hasShownHintRef.current && !readLongPressHintDismissed()) {
          hasShownHintRef.current = true;
          setTimeout(() => setShowLongPressHint(true), 400);
        }
      }
    }
  }, [cancelLongPress, isItemBlurred, isTileSelectionSuppressed, modeRef, onReviewHiddenItem, toggleSelected]);

  const handleItemPointerMove = useCallback((e: ReactPointerEvent) => {
    if (longPressTimerRef.current !== null && pointerDownPosRef.current) {
      const dx = e.clientX - pointerDownPosRef.current.x;
      const dy = e.clientY - pointerDownPosRef.current.y;
      if (dx * dx + dy * dy > LONG_PRESS_CANCEL_DIST_SQ) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  const handleItemPointerCancel = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const dismissLongPressHint = useCallback(() => {
    writeLongPressHintDismissed();
    setShowLongPressHint(false);
  }, []);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  return {
    selectedItems,
    setSelectedItems,
    showLongPressHint,
    dismissLongPressHint,
    toggleSelected,
    cancelLongPress,
    suppressTileSelectionBriefly,
    onPointerDown: handleItemPointerDown,
    onPointerUp: handleItemPointerUp,
    onPointerMove: handleItemPointerMove,
    onPointerCancel: handleItemPointerCancel,
  };
}
