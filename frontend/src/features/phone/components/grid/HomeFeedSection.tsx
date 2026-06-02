import type { RecallMediaItem } from "@/shared/types/recall";
import { MediaGrid, GridZoomControls } from "./MediaGrid";
import { useGridHandlers } from "./GridHandlersContext";
import { Button } from "@/components/ui/button";
import type { HomeFeed } from "../../model/homeFeed";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

interface HomeFeedSectionProps {
  feed: HomeFeed;
  items: RecallMediaItem[];
  homeGridRef: React.Ref<HTMLDivElement>;
  isLoading: boolean;
  isLoadingMore?: boolean;
  onFeedChange: (feed: HomeFeed) => void;
}

const FEED_LABELS: Record<HomeFeed, string> = {
  favorites: "Favorites",
  recents: "Recents",
};

export function HomeFeedSection({ feed, items, homeGridRef, isLoading, isLoadingMore = false, onFeedChange }: HomeFeedSectionProps) {
  const { pinchHandlers, gridColumns, zoomGridIn, zoomGridOut, mediaGridClassName } = useGridHandlers();
  const feedLabel = FEED_LABELS[feed];
  const countLabel = feed === "recents" ? `${items.length} loaded` : `${items.length} items`;

  return (
    <section className="phone-home-feed-section phone-media-grid-zone" data-testid="phone-home-feed-grid-zone" data-phone-feed={feed} aria-labelledby="phone-home-feed-title" {...pinchHandlers}>
      <div className="phone-home-feed-header">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="phone-home-feed-title"
              className="phone-home-feed-title phone-home-feed-trigger"
              type="button"
              variant="ghost"
              aria-label={`Choose home feed, current feed ${feedLabel}`}
            >
              <span>{feedLabel}</span>
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="phone-home-feed-menu">
            {(["favorites", "recents"] as const).map((option) => {
              const selected = option === feed;
              return (
                <DropdownMenuItem
                  key={option}
                  className="phone-home-feed-menu-item"
                  role="menuitemradio"
                  aria-checked={selected}
                  onSelect={() => onFeedChange(option)}
                >
                  <span>{FEED_LABELS[option]}</span>
                  {selected ? <CheckIcon aria-hidden /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="phone-home-feed-actions">
          {!isLoading ? (
            <span className="phone-home-feed-count">{countLabel}</span>
          ) : null}
          <GridZoomControls columns={gridColumns} onZoomIn={zoomGridIn} onZoomOut={zoomGridOut} />
        </div>
      </div>
      <MediaGrid
        items={items}
        gridRef={homeGridRef}
        scope={feed}
        ariaLabel={`${feedLabel} media grid`}
        className={`${mediaGridClassName} phone-home-feed-grid`}
        isLoading={isLoading}
        loadingCount={9}
        loadingKeyPrefix={`${feed}-skeleton`}
        emptyContent={<div className="phone-home-feed-empty">{feed === "recents" ? "No recent media" : "No favorites"}</div>}
        trailingLoadingCount={isLoadingMore ? 6 : 0}
        trailingLoadingKeyPrefix={`${feed}-more`}
      />
    </section>
  );
}
