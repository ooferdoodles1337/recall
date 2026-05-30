import { AnimatePresence, motion } from "motion/react";
import { SearchAssistPanel } from "./SearchCommandLayer";

interface PhoneSearchShellProps {
  mode: string;
  contentMode: string;
  query: string;
  showHistory: boolean;
  activeHistory: string[];
  composeSuggestions: string[];
  visibleHistory: string[];
  isSearching: boolean;
  renderSearchBar: (className?: string, clearLabel?: string) => React.ReactNode;
  onAssistSearch: (q: string) => void;
  onClearHistory: () => void;
  onRemoveHistoryItem: (item: string) => void;
}

export function PhoneSearchShell({
  mode, contentMode, query, showHistory, activeHistory,
  composeSuggestions, visibleHistory, isSearching,
  onAssistSearch, onClearHistory, onRemoveHistoryItem, renderSearchBar,
}: PhoneSearchShellProps) {
  const showPersistent = mode !== "home" && !(mode === "compose" && contentMode === "home");

  return (
    <>
      {showPersistent ? (
        <div className="phone-persistent-section phone-persistent-search">
          <div className={`search-panel${mode === "compose" ? " search-panel--expanded" : ""}`}>
            {renderSearchBar()}
            <AnimatePresence initial={false}>
              {mode === "compose" ? (
                <motion.div key="compose-results-inline" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
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
      ) : (
        <div className="phone-startpage-search-sticky">
          <div className={`search-panel${mode === "compose" ? " search-panel--expanded" : ""}`}>
            {renderSearchBar(undefined, "Clear draft search")}
            <AnimatePresence initial={false}>
              {mode === "compose" ? (
                <motion.div key="compose-home-inline" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
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
      )}
    </>
  );
}