import { useEffect, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { RecallMediaItem } from "@/shared/types/recall";
import type { PhoneScreen } from "../phoneReducer";
import { OVERSCROLL_THRESHOLD } from "../phoneUtils";

interface SearchLiveState {
  hasMore: boolean;
  prefetchedResults: RecallMediaItem[] | null;
}

interface UseResultsPullToLoadMoreOptions {
  liveRef: MutableRefObject<SearchLiveState>;
  loadMore: () => Promise<void>;
  applyPrefetchedResults: () => void;
  mode: PhoneScreen;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function useResultsPullToLoadMore({
  liveRef,
  loadMore,
  applyPrefetchedResults,
  mode,
  scrollContainerRef,
}: UseResultsPullToLoadMoreOptions) {
  const [overscrollProgress, setOverscrollProgress] = useState(0);
  const [pullDismissing, setPullDismissing] = useState(false);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || mode !== "results") return;
    let hitBottomAtY: number | null = null;
    let touchStartY = 0;
    let currentOverscroll = 0;

    const isAtBottom = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0].clientY;
      hitBottomAtY = null;
      currentOverscroll = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touchY = event.touches[0].clientY;
      if (isAtBottom()) {
        if (hitBottomAtY === null && touchStartY > touchY) hitBottomAtY = touchY;
        if (hitBottomAtY !== null) {
          const delta = Math.max(0, hitBottomAtY - touchY);
          currentOverscroll = delta;
          if (delta > 0) {
            event.preventDefault();
            setOverscrollProgress(Math.min(1, delta / OVERSCROLL_THRESHOLD));
          }
        }
      } else if (currentOverscroll > 0) {
        currentOverscroll = 0;
        hitBottomAtY = null;
        setOverscrollProgress(0);
      }
    };
    const onTouchEnd = () => {
      const delta = currentOverscroll;
      currentOverscroll = 0;
      setOverscrollProgress(0);
      if (delta >= OVERSCROLL_THRESHOLD && liveRef.current.hasMore) {
        setPullDismissing(true);
        setTimeout(() => setPullDismissing(false), 200);
        if (liveRef.current.prefetchedResults) {
          applyPrefetchedResults();
        } else {
          void loadMore();
        }
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [applyPrefetchedResults, liveRef, loadMore, mode, scrollContainerRef]);

  return { overscrollProgress, pullDismissing };
}
