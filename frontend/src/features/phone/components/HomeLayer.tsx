import { motion } from "motion/react";
import { PhoneHomeHeader } from "./PhoneHomeHeader";
import { FavoritesSection } from "./FavoritesSection";
import type { RecallMediaItem } from "@/shared/types/recall";
import { screenMotionVariants, type ModeTransition } from "./phoneUtils";

interface HomeLayerProps {
  visible: boolean;
  modeTransition: ModeTransition;
  onExit?: () => void;
  favoriteItems: RecallMediaItem[];
  favoritesGridRef: React.RefObject<HTMLDivElement | null>;
  mediaGridClassName: string;
  pinchHandlers: Record<string, (e: any) => void>;
  gridColumns: number;
  isLoadingFavorites: boolean;
  usesNaturalAspectGrid: boolean;
  selectedItems: RecallMediaItem[];
  isItemBlurred: (item: RecallMediaItem) => boolean;
  zoomGridIn: () => void;
  zoomGridOut: () => void;
  handleItemPointerDown: (e: React.PointerEvent, item: RecallMediaItem) => void;
  handleItemPointerUp: (e: React.PointerEvent, item: RecallMediaItem) => void;
  handleItemPointerMove: (e: React.PointerEvent) => void;
  handleItemPointerCancel: () => void;
  toggleSelected: (item: RecallMediaItem) => void;
}

export function HomeLayer({ visible, modeTransition, onExit, favoriteItems, favoritesGridRef,
  mediaGridClassName, pinchHandlers, gridColumns, isLoadingFavorites, usesNaturalAspectGrid,
  selectedItems, isItemBlurred, zoomGridIn, zoomGridOut,
  handleItemPointerDown, handleItemPointerUp, handleItemPointerMove, handleItemPointerCancel, toggleSelected }: HomeLayerProps) {
  const showFavoritesSection = isLoadingFavorites || favoriteItems.length > 0;
  if (!visible) return null;
  return (
    <motion.div key="screen-home" className="phone-screen phone-screen--home"
      custom={modeTransition} variants={screenMotionVariants} initial="enter" animate="center" exit="exit">
      <div className="phone-startpage">
        <PhoneHomeHeader onExit={onExit} />
        {showFavoritesSection ? (
          <FavoritesSection favoriteItems={favoriteItems} favoritesGridRef={favoritesGridRef} gridClassName={mediaGridClassName}
            gridGestureHandlers={pinchHandlers as any} gridColumns={gridColumns} isLoadingFavorites={isLoadingFavorites}
            naturalAspectRatio={usesNaturalAspectGrid} selectedItems={selectedItems} isItemBlurred={isItemBlurred}
            onZoomIn={zoomGridIn} onZoomOut={zoomGridOut}
            onItemPointerDown={handleItemPointerDown} onItemPointerUp={handleItemPointerUp}
            onItemPointerMove={handleItemPointerMove} onItemPointerCancel={handleItemPointerCancel}
            toggleSelected={toggleSelected} />
        ) : null}
      </div>
    </motion.div>
  );
}