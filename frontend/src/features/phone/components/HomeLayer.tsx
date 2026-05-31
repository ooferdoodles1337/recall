import { motion } from "motion/react";
import { FavoritesSection } from "./FavoritesSection";
import type { RecallMediaItem } from "@/shared/types/recall";
import { screenMotionVariants, type ModeTransition } from "./phoneUtils";

interface HomeLayerProps {
  visible: boolean;
  modeTransition: ModeTransition;
  favoriteItems: RecallMediaItem[];
  favoritesGridRef: React.RefObject<HTMLDivElement | null>;
  isLoadingFavorites: boolean;
}

export function HomeLayer({ visible, modeTransition, favoriteItems, favoritesGridRef, isLoadingFavorites }: HomeLayerProps) {
  const showFavoritesSection = isLoadingFavorites || favoriteItems.length > 0;
  if (!visible) return null;
  return (
    <motion.div key="screen-home" className="phone-screen phone-screen--home"
      custom={modeTransition} variants={screenMotionVariants} initial="enter" animate="center" exit="exit">
      <div className="phone-startpage">
        {showFavoritesSection ? (
          <FavoritesSection favoriteItems={favoriteItems} favoritesGridRef={favoritesGridRef} isLoadingFavorites={isLoadingFavorites} />
        ) : null}
      </div>
    </motion.div>
  );
}
