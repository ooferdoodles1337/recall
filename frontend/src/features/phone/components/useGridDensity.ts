import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";
import {
  type GridColumns,
  GRID_COLUMN_OPTIONS,
  GRID_GAP_BY_COLUMNS,
  GRID_RADIUS_BY_COLUMNS,
  readGridColumns,
  writeGridColumns,
  pointerDistance,
  pointerMidpoint,
  nearestGridColumns,
  reduceMotionEnabled,
} from "./phoneUtils";

type GridPoint = { x: number; y: number };
type GridItemSnapshot = Map<string, DOMRect>;
type PinchGesture = {
  startColumns: GridColumns;
  startDistance: number;
  midpoint: GridPoint;
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
  homeGridRef: React.RefObject<HTMLDivElement | null>,
  searchGridRef: React.RefObject<HTMLDivElement | null>,
  homeItems: RecallMediaItem[],
  results: RecallMediaItem[],
  isLoading: boolean,
  isLoadingHomeFeed: boolean,
  isLoadingMore: boolean,
  mode: string,
  cancelLongPress: () => void,
  suppressTileSelectionBriefly: () => void,
): GridDensityApi {
  const [gridColumns, setGridColumns] = useState<GridColumns>(() => readGridColumns());
  const gridColumnsRef = useRef<GridColumns>(gridColumns);
  const pendingGridSnapshotRef = useRef<GridItemSnapshot | null>(null);
  const gridFlipAnimationsRef = useRef<Animation[]>([]);
  const activeTouchPointersRef = useRef<Map<number, GridPoint>>(new Map());
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const wheelAccumRef = useRef(0);

  useEffect(() => { gridColumnsRef.current = gridColumns; }, [gridColumns]);

  const gridDensityStyle = useMemo(() => ({
    "--phone-grid-columns": String(gridColumns),
    "--phone-grid-gap": GRID_GAP_BY_COLUMNS[gridColumns],
    "--phone-grid-radius": GRID_RADIUS_BY_COLUMNS[gridColumns],
  }) as React.CSSProperties, [gridColumns]);

  const captureGridSnapshot = useCallback((): GridItemSnapshot => {
    const snapshot: GridItemSnapshot = new Map();
    for (const grid of [homeGridRef.current, searchGridRef.current]) {
      if (!grid) continue;
      const scope = grid.dataset.phoneGridScope ?? "grid";
      grid.querySelectorAll<HTMLElement>("[data-phone-grid-item]").forEach((element) => {
        const id = element.dataset.phoneGridItem;
        if (id) snapshot.set(`${scope}:${id}`, element.getBoundingClientRect());
      });
    }
    return snapshot;
  }, [homeGridRef, searchGridRef]);

  const updateGridColumns = useCallback((nextColumns: GridColumns) => {
    if (nextColumns === gridColumnsRef.current) return;
    pendingGridSnapshotRef.current = captureGridSnapshot();
    gridColumnsRef.current = nextColumns;
    writeGridColumns(nextColumns);
    setGridColumns(nextColumns);
  }, [captureGridSnapshot]);

  useLayoutEffect(() => {
    const snapshot = pendingGridSnapshotRef.current;
    if (!snapshot) return;
    pendingGridSnapshotRef.current = null;
    gridFlipAnimationsRef.current.forEach((a) => a.cancel());
    gridFlipAnimationsRef.current = [];
    if (snapshot.size === 0 || reduceMotionEnabled()) return;
    const animations: Animation[] = [];
    for (const grid of [homeGridRef.current, searchGridRef.current]) {
      if (!grid) continue;
      const scope = grid.dataset.phoneGridScope ?? "grid";
      grid.querySelectorAll<HTMLElement>("[data-phone-grid-item]").forEach((element) => {
        const id = element.dataset.phoneGridItem;
        if (!id) return;
        const first = snapshot.get(`${scope}:${id}`);
        if (!first) return;
        const last = element.getBoundingClientRect();
        const dx = first.left - last.left, dy = first.top - last.top;
        const sx = first.width / Math.max(last.width, 1), sy = first.height / Math.max(last.height, 1);
        if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5 && Math.abs(sx - 1) <= 0.01 && Math.abs(sy - 1) <= 0.01) return;
        const anim = element.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: "center" },
           { transform: "translate(0, 0) scale(1, 1)", transformOrigin: "center" }],
          { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
        animations.push(anim);
        anim.finished.catch(() => undefined).finally(() => {
          gridFlipAnimationsRef.current = gridFlipAnimationsRef.current.filter((a) => a !== anim);
        });
      });
    }
    gridFlipAnimationsRef.current = animations;
  }, [homeItems, gridColumns, isLoading, isLoadingHomeFeed, isLoadingMore, mode, results, homeGridRef, searchGridRef]);

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
      pinchGestureRef.current = { startColumns: gridColumnsRef.current, startDistance: sd, midpoint: pointerMidpoint(first, second) };
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
      pinch.midpoint = pointerMidpoint(first, second);
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
