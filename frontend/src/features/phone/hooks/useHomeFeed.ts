import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecallMediaItem } from "@/shared/types/recall";
import { FAVORITES_COUNT, PREFETCH_TRIGGER_REMAINING, SEARCH_BATCH_SIZE } from "../phoneUtils";
import { listFavoriteItems, listRecentItems } from "../api/searchApi";
import type { PhoneBgContent } from "../phoneReducer";
import {
  HOME_RECENTS_MAX,
  RECENTS_PREFETCH_STALE_MS,
  RECENTS_PREFETCH_VIEWPORT_MULTIPLIER,
  readDefaultHomeFeed,
  writeDefaultHomeFeed,
  type HomeFeed,
} from "../model/homeFeed";
import { phoneQueryKeys } from "../model/queryKeys";

interface UseHomeFeedOptions {
  contentMode: PhoneBgContent;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onFeedSwitchItems?: (items: RecallMediaItem[]) => void;
  onScrollRestored?: (scrollTop: number) => void;
}

export function useHomeFeed({
  contentMode,
  scrollContainerRef,
  onFeedSwitchItems,
  onScrollRestored,
}: UseHomeFeedOptions) {
  const queryClient = useQueryClient();
  const [defaultFeed, setDefaultFeedState] = useState<HomeFeed>(readDefaultHomeFeed);
  const [feed, setFeed] = useState<HomeFeed>(defaultFeed);
  const [recentLimit, setRecentLimit] = useState(SEARCH_BATCH_SIZE);
  const feedScrollTopRef = useRef<Record<HomeFeed, number>>({ favorites: 0, recents: 0 });

  const favoritesQuery = useQuery({
    queryKey: phoneQueryKeys.favorites(FAVORITES_COUNT),
    queryFn: () => listFavoriteItems(FAVORITES_COUNT),
  });
  const favoriteItems = favoritesQuery.data?.results ?? [];
  const isLoadingFavorites = favoritesQuery.isPending;

  const recentItemsQuery = useQuery({
    queryKey: phoneQueryKeys.recent(recentLimit),
    queryFn: () => listRecentItems(recentLimit),
    enabled: feed === "recents",
    placeholderData: (previous) => previous,
    staleTime: RECENTS_PREFETCH_STALE_MS,
  });
  const recentItems = recentItemsQuery.data?.results ?? [];
  const isLoadingRecents = feed === "recents" && recentItemsQuery.isPending;
  const isLoadingMoreRecents = feed === "recents" && recentItems.length > 0 && recentItemsQuery.isFetching;
  const hasMoreRecents = feed === "recents" && recentItems.length >= recentLimit && recentLimit < HOME_RECENTS_MAX;
  const nextRecentLimit = hasMoreRecents ? Math.min(recentLimit + SEARCH_BATCH_SIZE, HOME_RECENTS_MAX) : null;

  const items = feed === "recents" ? recentItems : favoriteItems;
  const isLoading = feed === "recents" ? isLoadingRecents : isLoadingFavorites;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || contentMode !== "home" || feed !== "recents") return;
    const handleScroll = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      const triggerDistance = Math.max(
        PREFETCH_TRIGGER_REMAINING,
        el.clientHeight * RECENTS_PREFETCH_VIEWPORT_MULTIPLIER,
      );
      if (remaining >= triggerDistance) return;
      if (!nextRecentLimit || recentItemsQuery.isFetching) return;
      setRecentLimit(nextRecentLimit);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [contentMode, feed, nextRecentLimit, recentItemsQuery.isFetching, scrollContainerRef]);

  useEffect(() => {
    if (contentMode !== "home" || feed !== "recents" || !nextRecentLimit || recentItemsQuery.isFetching) return;
    void queryClient.prefetchQuery({
      queryKey: phoneQueryKeys.recent(nextRecentLimit),
      queryFn: () => listRecentItems(nextRecentLimit),
      staleTime: RECENTS_PREFETCH_STALE_MS,
    });
  }, [contentMode, feed, nextRecentLimit, queryClient, recentItemsQuery.isFetching]);

  const changeFeed = useCallback((nextFeed: HomeFeed) => {
    if (nextFeed === feed) return;
    const el = scrollContainerRef.current;
    if (el) feedScrollTopRef.current[feed] = el.scrollTop;
    const nextItems = nextFeed === "recents" ? recentItems : favoriteItems;
    onFeedSwitchItems?.(nextItems);
    setFeed(nextFeed);
    window.setTimeout(() => {
      const target = feedScrollTopRef.current[nextFeed] ?? 0;
      scrollContainerRef.current?.scrollTo({ top: target });
      onScrollRestored?.(target);
    }, 0);
  }, [favoriteItems, feed, onFeedSwitchItems, onScrollRestored, recentItems, scrollContainerRef]);

  // The persisted default for future sessions; also applies to the live grid now.
  const setDefaultFeed = useCallback((nextFeed: HomeFeed) => {
    setDefaultFeedState(nextFeed);
    writeDefaultHomeFeed(nextFeed);
    changeFeed(nextFeed);
  }, [changeFeed]);

  return {
    feed,
    items,
    isLoading,
    isLoadingMore: isLoadingMoreRecents,
    favoriteItems,
    recentItems,
    changeFeed,
    defaultFeed,
    setDefaultFeed,
  };
}
