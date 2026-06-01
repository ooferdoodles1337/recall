import React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ClockIcon,
  HistoryIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";

const assistPanelMotion = {
  initial: { opacity: 0, y: -6, scale: 0.985 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.99,
    transition: { duration: 0.12, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
  },
};

interface PhoneSearchBarProps {
  value: string;
  className?: string;
  clearLabel?: string;
  showHistory: boolean;
  showHistoryIcon: boolean;
  isSearching?: boolean;
  onToggleHistory: () => void;
  onFocus: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}

export const PhoneSearchBar = React.forwardRef<HTMLInputElement, PhoneSearchBarProps>(function PhoneSearchBar(
  {
    value,
    className,
    clearLabel = "Clear search",
    showHistory,
    showHistoryIcon,
    isSearching = false,
    onToggleHistory,
    onFocus,
    onChange,
    onSubmit,
    onClear,
  },
  ref,
) {
  return (
    <div className={`search-bar search-bar--semantic${showHistoryIcon ? "" : " search-bar--no-icon"}${className ? ` ${className}` : ""}`}>
      {showHistoryIcon ? (
        <Button
          className={`history-btn${showHistory ? " history-btn--active" : ""}`}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Recent searches"
          aria-pressed={showHistory}
          onClick={onToggleHistory}
          disabled={isSearching}
        >
          {isSearching ? <Loader2Icon className="animate-spin" /> : <HistoryIcon />}
        </Button>
      ) : null}
      <Input
        ref={ref}
        aria-label="Search your media"
        value={value}
        placeholder="Describe a photo or video..."
        autoComplete="off"
        enterKeyHint="search"
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
        }}
      />
      {value ? (
        <Button
          className="clear-search-btn"
          variant="ghost"
          size="icon-sm"
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
});

interface SearchAssistPanelProps {
  query: string;
  showHistory: boolean;
  history: string[];
  suggestions: string[];
  knownHistory: string[];
  isSearching?: boolean;
  onRunSearch: (query: string) => void;
  onClearHistory: () => void;
  onRemoveHistoryItem: (query: string) => void;
}

export function SearchAssistPanel({
  query,
  showHistory,
  history,
  suggestions,
  knownHistory,
  isSearching = false,
  onRunSearch,
  onClearHistory,
  onRemoveHistoryItem,
}: SearchAssistPanelProps) {
  const trimmedQuery = query.trim();
  const showHistoryPanel = (showHistory || !trimmedQuery || suggestions.length === 0) && history.length > 0;

  return (
    <AnimatePresence initial={false} mode="wait">
      {showHistoryPanel ? (
        <motion.div
          key="search-history"
          className="phone-panel-motion"
          variants={assistPanelMotion}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <div className="phone-history-header">
            <span className="phone-history-header-label">Recent</span>
            <Button className="phone-history-clear-btn h-auto" type="button" variant="ghost" size="xs" onClick={onClearHistory}>
              Clear all
            </Button>
          </div>
          {history.map((item) => (
            <div key={item} className="phone-history-row">
              <Button className="suggestion-item h-auto justify-start" type="button" variant="ghost" onClick={() => onRunSearch(item)}>
                <span className="suggestion-icon" aria-hidden>
                  <ClockIcon />
                </span>
                <span>{item}</span>
              </Button>
              <Button className="phone-history-remove" type="button" variant="ghost" size="icon-sm" onClick={() => onRemoveHistoryItem(item)} aria-label={`Remove ${item}`}>
                <XIcon />
              </Button>
            </div>
          ))}
        </motion.div>
      ) : trimmedQuery && suggestions.length > 0 ? (
        <motion.div
          key="search-suggestions"
          className="phone-panel-motion"
          variants={assistPanelMotion}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {suggestions.map((suggestion) => {
            const fromHistory = knownHistory.some((item) => item.toLowerCase() === suggestion.toLowerCase());
            return (
              <Button key={suggestion} className="suggestion-item h-auto justify-start w-full" type="button" variant="ghost" onClick={() => onRunSearch(suggestion)}>
                <span className="suggestion-icon" aria-hidden>{fromHistory ? <ClockIcon /> : <SearchIcon />}</span>
                <span>{suggestion}</span>
              </Button>
            );
          })}
        </motion.div>
      ) : trimmedQuery ? (
        <motion.div
          key="search-empty"
          className="phone-panel-motion"
          variants={assistPanelMotion}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <Empty className="search-empty phone-compose-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>{isSearching ? "Searching…" : "Press Enter to search"}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
