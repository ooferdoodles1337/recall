import { createContext, useContext } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { GridGestureHandlers } from "./MediaGrid";

export type GridHandlers = {
  selectedItems: RecallMediaItem[];
  isItemBlurred: (item: RecallMediaItem) => boolean;
  onPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
  pinchHandlers: GridGestureHandlers;
  gridColumns: number;
  zoomGridIn: () => void;
  zoomGridOut: () => void;
  mediaGridClassName: string;
  naturalAspectRatio: boolean;
};

export const GridHandlersContext = createContext<GridHandlers | null>(null);

export function useGridHandlers(): GridHandlers {
  const ctx = useContext(GridHandlersContext);
  if (!ctx) throw new Error("useGridHandlers must be used inside GridHandlersContext.Provider");
  return ctx;
}
