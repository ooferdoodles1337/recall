import { useEffect } from "react";
import type { RefObject } from "react";

const SCROLL_CHAIN_BOUNDARY_SELECTOR = ".phone-rect-viewport, .about-sheet-scroll";

function isPhoneTouchSurface(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Node)) return false;
  if (root.contains(target)) return true;
  if (!(target instanceof Element)) return false;
  return target.closest(".about-sheet") !== null;
}

function scrollBoundaryForTarget(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const boundary = target.closest<HTMLElement>(SCROLL_CHAIN_BOUNDARY_SELECTOR);
  if (!boundary) return null;
  if (root.contains(boundary) || boundary.closest(".about-sheet")) return boundary;
  return null;
}

function canScrollVertically(el: HTMLElement): boolean {
  return el.scrollHeight - el.clientHeight > 1;
}

function isTryingToLeaveScrollBoundary(el: HTMLElement, deltaY: number): boolean {
  if (!canScrollVertically(el)) return true;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  return (deltaY > 0 && atTop) || (deltaY < 0 && atBottom);
}

export function useScrollContainment(rootRef: RefObject<HTMLElement | null>) {
  // SR-5: contain touch drags inside phone scroll regions so the page cannot
  // become the scroll target and trigger browser pull-to-refresh.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let startedInsidePhoneSurface = false;
    let activeScrollBoundary: HTMLElement | null = null;
    let lastTouchX = 0;
    let lastTouchY = 0;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        startedInsidePhoneSurface = false;
        activeScrollBoundary = null;
        return;
      }

      startedInsidePhoneSurface = isPhoneTouchSurface(event.target, root);
      activeScrollBoundary = startedInsidePhoneSurface
        ? scrollBoundaryForTarget(event.target, root)
        : null;
      lastTouchX = event.touches[0].clientX;
      lastTouchY = event.touches[0].clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!startedInsidePhoneSurface || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - lastTouchX;
      const deltaY = touch.clientY - lastTouchY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;

      if (Math.abs(deltaY) <= Math.abs(deltaX)) return;

      const shouldPrevent = activeScrollBoundary
        ? isTryingToLeaveScrollBoundary(activeScrollBoundary, deltaY)
        : true;

      if (shouldPrevent && event.cancelable) event.preventDefault();
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
    };
  }, [rootRef]);
}
