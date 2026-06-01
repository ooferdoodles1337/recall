import { AnimatePresence, motion } from "motion/react";
import { SearchAssistPanel } from "./SearchCommandLayer";

interface PhoneSearchShellProps {
  mode: string;
  query: string;
  showHistory: boolean;
  activeHistory: string[];
  composeSuggestions: string[];
  visibleHistory: string[];
  isSearching: boolean;
  showComposePanel: boolean;
  renderSearchBar: (className?: string, clearLabel?: string) => React.ReactNode;
  onAssistSearch: (q: string) => void;
  onClearHistory: () => void;
  onRemoveHistoryItem: (item: string) => void;
}

export function PhoneSearchShell({
  mode, query, showHistory, activeHistory,
  composeSuggestions, visibleHistory, isSearching, showComposePanel,
  onAssistSearch, onClearHistory, onRemoveHistoryItem, renderSearchBar,
}: PhoneSearchShellProps) {
  return (
    <div className="phone-persistent-section phone-persistent-search">
      <div className={`search-panel${mode === "compose" && showComposePanel ? " search-panel--expanded" : ""}`}>
        {renderSearchBar()}
        <AnimatePresence initial={false}>
          {mode === "compose" && showComposePanel ? (
            <motion.div key="compose-panel" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }} style={{ overflow: "hidden" }}>
              <div className="phone-compose-section">
                <SearchAssistPanel query={query} showHistory={showHistory} history={activeHistory} suggestions={composeSuggestions}
                  knownHistory={visibleHistory} isSearching={isSearching}
                  onRunSearch={onAssistSearch} onClearHistory={onClearHistory} onRemoveHistoryItem={onRemoveHistoryItem} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}