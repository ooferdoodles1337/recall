import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GridColumns,
  GRID_COLUMN_OPTIONS,
  GRID_GAP_BY_COLUMNS,
  GRID_RADIUS_BY_COLUMNS,
  readGridColumns,
  writeGridColumns,
  pointerDistance,
  nearestGridColumns,
} from "../phoneUtils";

type GridPoint = { x: number; y: number };
type PinchGesture = {
  startColumns: GridColumns;
  startDistance: number;
};

export type GridDensityApi = {
  gridColumns: GridColumns;
  gridDensityStyle: React.CSSProperties;
  zoomGridIn: () => void;
  zoomGridOut: () => void;
  pinchHandlers: Pick<React.HTMLAttributes<HTMLElement>, "onPointerDownCapture" | "onPointerMoveCapture" | "onPointerUpCapture" | "onPointerCancelCapture">;
  wheelHandler: (el: HTMLElement) => () => void;
  updateGridColumns: (cols: GridColumns) => void;
};

export function useGridDensity(
  cancelLongPress: () => void,
  suppressTileSelectionBriefly: () => void,
): GridDensityApi {
  const [gridColumns, setGridColumns] = useState<GridColumns>(() => readGridColumns());
  const gridColumnsRef = useRef<GridColumns>(gridColumns);
  const activeTouchPointersRef = useRef<Map<number, GridPoint>>(new Map());
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const wheelAccumRef = useRef(0);

  useEffect(() => { gridColumnsRef.current = gridColumns; }, [gridColumns]);

  const gridDensityStyle = useMemo(() => ({
    "--phone-grid-columns": String(gridColumns),
    "--phone-grid-gap": GRID_GAP_BY_COLUMNS[gridColumns],
    "--phone-grid-radius": GRID_RADIUS_BY_COLUMNS[gridColumns],
  }) as React.CSSProperties, [gridColumns]);

  const updateGridColumns = useCallback((nextColumns: GridColumns) => {
    if (nextColumns === gridColumnsRef.current) return;
    gridColumnsRef.current = nextColumns;
    writeGridColumns(nextColumns);
    setGridColumns(nextColumns);
  }, []);

  const zoomGridIn = useCallback(() => {
    const idx = GRID_COLUMN_OPTIONS.indexOf(gridColumnsRef.current);
    if (idx <= 0) return;
    updateGridColumns(GRID_COLUMN_OPTIONS[idx - 1]);
  }, [updateGridColumns]);

  const zoomGridOut = useCallback(() => {
    const idx = GRID_COLUMN_OPTIONS.indexOf(gridColumnsRef.current);
    if (idx >= GRID_COLUMN_OPTIONS.length - 1) return;
    updateGridColumns(GRID_COLUMN_OPTIONS[idx + 1]);
  }, [updateGridColumns]);

  const pinchHandlers = useMemo(() => ({
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      activeTouchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouchPointersRef.current.size < 2) return;
      const [first, second] = Array.from(activeTouchPointersRef.current.values());
      const sd = pointerDistance(first, second);
      if (sd <= 0) return;
      cancelLongPress();
      suppressTileSelectionBriefly();
      pinchGestureRef.current = { startColumns: gridColumnsRef.current, startDistance: sd };
    },
    onPointerMoveCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" || !activeTouchPointersRef.current.has(event.pointerId)) return;
      activeTouchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pinch = pinchGestureRef.current;
      if (!pinch || activeTouchPointersRef.current.size < 2) return;
      const [first, second] = Array.from(activeTouchPointersRef.current.values());
      const d = pointerDistance(first, second);
      if (d <= 0) return;
      if (event.cancelable) event.preventDefault();
      suppressTileSelectionBriefly();
      updateGridColumns(nearestGridColumns(pinch.startColumns / (d / pinch.startDistance)));
    },
    onPointerUpCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      activeTouchPointersRef.current.delete(event.pointerId);
      if (activeTouchPointersRef.current.size < 2 && pinchGestureRef.current) {
        pinchGestureRef.current = null;
        suppressTileSelectionBriefly();
      }
    },
    onPointerCancelCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      activeTouchPointersRef.current.delete(event.pointerId);
      if (activeTouchPointersRef.current.size < 2 && pinchGestureRef.current) {
        pinchGestureRef.current = null;
        suppressTileSelectionBriefly();
      }
    },
  }), [cancelLongPress, suppressTileSelectionBriefly, updateGridColumns]);

  const wheelHandler = useCallback((el: HTMLElement) => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const n = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;
      wheelAccumRef.current += n;
      if (wheelAccumRef.current > 60) { wheelAccumRef.current = 0; zoomGridOut(); }
      else if (wheelAccumRef.current < -60) { wheelAccumRef.current = 0; zoomGridIn(); }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomGridIn, zoomGridOut]);

  return { gridColumns, gridDensityStyle, zoomGridIn, zoomGridOut, pinchHandlers, wheelHandler, updateGridColumns };
}
