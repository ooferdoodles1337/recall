import { motion } from "motion/react";
import { HomeFeedSection } from "../grid/HomeFeedSection";
import type { RecallMediaItem } from "@/shared/types/recall";
import { screenMotionVariants, type ModeTransition } from "../../phoneUtils";
import type { HomeFeed } from "../../model/homeFeed";

interface HomeLayerProps {
  visible: boolean;
  modeTransition: ModeTransition;
  feed: HomeFeed;
  items: RecallMediaItem[];
  homeGridRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  isLoadingMore?: boolean;
  onFeedChange: (feed: HomeFeed) => void;
}

export function HomeLayer({ visible, modeTransition, feed, items, homeGridRef, isLoading, isLoadingMore = false, onFeedChange }: HomeLayerProps) {
  if (!visible) return null;
  return (
    <motion.div key="screen-home" className="phone-screen phone-screen--home"
      custom={modeTransition} variants={screenMotionVariants} initial="enter" animate="center" exit="exit">
      <div className="phone-startpage">
        <HomeFeedSection
          feed={feed}
          items={items}
          homeGridRef={homeGridRef}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onFeedChange={onFeedChange}
        />
      </div>
    </motion.div>
  );
}
