import type { RecallMediaItem } from "@/shared/types/recall";
import { MediaGrid, GridZoomControls, type GridGestureHandlers } from "./MediaGrid";

interface FavoritesSectionProps {
  favoriteItems: RecallMediaItem[];
  favoritesGridRef: React.Ref<HTMLDivElement>;
  gridClassName: string;
  gridGestureHandlers: GridGestureHandlers;
  gridColumns: number;
  isLoadingFavorites: boolean;
  naturalAspectRatio: boolean;
  selectedItems: RecallMediaItem[];
  isItemBlurred: (item: RecallMediaItem) => boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onItemPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onItemPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  onItemPointerMove: (e: React.PointerEvent) => void;
  onItemPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
}

export function FavoritesSection({
  favoriteItems,
  favoritesGridRef,
  gridClassName,
  gridGestureHandlers,
  gridColumns,
  isLoadingFavorites,
  naturalAspectRatio,
  selectedItems,
  isItemBlurred,
  onZoomIn,
  onZoomOut,
  onItemPointerDown,
  onItemPointerUp,
  onItemPointerMove,
  onItemPointerCancel,
  toggleSelected,
}: FavoritesSectionProps) {
  return (
    <section className="phone-favorites-section phone-media-grid-zone" data-testid="phone-favorites-grid-zone" aria-labelledby="phone-favorites-title" {...gridGestureHandlers}>
      <div className="phone-favorites-header">
        <h2 id="phone-favorites-title" className="phone-favorites-title">Favorites</h2>
        <div className="phone-favorites-actions">
          {!isLoadingFavorites ? (
            <span className="phone-favorites-count">{favoriteItems.length} items</span>
          ) : null}
          <GridZoomControls columns={gridColumns} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />
        </div>
      </div>
      <MediaGrid
        items={favoriteItems}
        gridRef={favoritesGridRef}
        scope="favorites"
        ariaLabel="Favorite media grid"
        className={`${gridClassName} phone-favorites-grid`}
        naturalAspectRatio={naturalAspectRatio}
        selectedItems={selectedItems}
        isItemBlurred={isItemBlurred}
        onPointerDown={onItemPointerDown}
        onPointerUp={onItemPointerUp}
        onPointerMove={onItemPointerMove}
        onPointerCancel={onItemPointerCancel}
        toggleSelected={toggleSelected}
        isLoading={isLoadingFavorites}
        loadingCount={9}
        loadingKeyPrefix="favorite-skeleton"
      />
    </section>
  );
}