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
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

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
    <motion.div layoutId="search-bar" className={`search-bar search-bar--semantic${className ? ` ${className}` : ""}`}>
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
    </motion.div>
  );
});

interface SearchAssistPanelProps {
  query: string;
  showHistory: boolean;
  history: string[];
  suggestions: string[];
  knownHistory: string[];
  className?: string;
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
  className = "phone-compose-section",
  isSearching = false,
  onRunSearch,
  onClearHistory,
  onRemoveHistoryItem,
}: SearchAssistPanelProps) {
  const trimmedQuery = query.trim();
  const showHistoryPanel = (showHistory || !trimmedQuery) && history.length > 0;
  const panelClassName = `${className} phone-panel-motion`;

  return (
    <AnimatePresence initial={false} mode="wait">
      {showHistoryPanel ? (
        <motion.div
          key="search-history"
          className={panelClassName}
          variants={assistPanelMotion}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <Card className="suggestions" size="sm">
            <CardContent className="p-0">
              {history.map((item, idx) => (
                <React.Fragment key={item}>
                  <div className="phone-history-row">
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
                  {idx < history.length - 1 ? <Separator className="phone-list-separator" /> : null}
                </React.Fragment>
              ))}
            </CardContent>
          </Card>
          <div className="phone-history-footer">
            <Button className="h-auto" type="button" variant="ghost" size="xs" onClick={onClearHistory}>
              Clear all
            </Button>
          </div>
        </motion.div>
      ) : trimmedQuery && suggestions.length > 0 ? (
        <motion.div
          key="search-suggestions"
          className={panelClassName}
          variants={assistPanelMotion}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <Card className="suggestions" size="sm">
            <CardContent className="p-0">
              {suggestions.map((suggestion, idx) => {
                const fromHistory = knownHistory.some((item) => item.toLowerCase() === suggestion.toLowerCase());
                return (
                  <React.Fragment key={suggestion}>
                    <Button className="suggestion-item h-auto justify-start w-full" type="button" variant="ghost" onClick={() => onRunSearch(suggestion)}>
                      <span className="suggestion-icon" aria-hidden>{fromHistory ? <ClockIcon /> : <SearchIcon />}</span>
                      <span>{suggestion}</span>
                    </Button>
                    {idx < suggestions.length - 1 ? <Separator className="phone-list-separator" /> : null}
                  </React.Fragment>
                );
              })}
            </CardContent>
          </Card>
        </motion.div>
      ) : trimmedQuery ? (
        <motion.div
          key="search-empty"
          className={panelClassName}
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
