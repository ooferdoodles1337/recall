import type { RecallMediaItem } from "@/shared/types/recall";
import { MediaGrid, GridZoomControls } from "./MediaGrid";
import { useGridHandlers } from "./GridHandlersContext";

interface FavoritesSectionProps {
  favoriteItems: RecallMediaItem[];
  favoritesGridRef: React.Ref<HTMLDivElement>;
  isLoadingFavorites: boolean;
}

export function FavoritesSection({ favoriteItems, favoritesGridRef, isLoadingFavorites }: FavoritesSectionProps) {
  const { pinchHandlers, gridColumns, zoomGridIn, zoomGridOut, mediaGridClassName } = useGridHandlers();
  return (
    <section className="phone-favorites-section phone-media-grid-zone" data-testid="phone-favorites-grid-zone" aria-labelledby="phone-favorites-title" {...pinchHandlers}>
      <div className="phone-favorites-header">
        <h2 id="phone-favorites-title" className="phone-favorites-title">Favorites</h2>
        <div className="phone-favorites-actions">
          {!isLoadingFavorites ? (
            <span className="phone-favorites-count">{favoriteItems.length} items</span>
          ) : null}
          <GridZoomControls columns={gridColumns} onZoomIn={zoomGridIn} onZoomOut={zoomGridOut} />
        </div>
      </div>
      <MediaGrid
        items={favoriteItems}
        gridRef={favoritesGridRef}
        scope="favorites"
        ariaLabel="Favorite media grid"
        className={`${mediaGridClassName} phone-favorites-grid`}
        isLoading={isLoadingFavorites}
        loadingCount={9}
        loadingKeyPrefix="favorite-skeleton"
      />
    </section>
  );
}
