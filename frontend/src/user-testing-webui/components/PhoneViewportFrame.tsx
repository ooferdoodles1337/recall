import { useEffect, useMemo, useState } from "react";
import type { RecallMediaItem, RecallSearchResult } from "../../shared/types/recall";
import {
  listRecentItems,
  searchSemantic,
  searchSimilarById,
  searchText,
  suggestSearches,
} from "../../phone-tester-ui/api/searchApi";
import { isVideo, resolvedMediaUrl, resolvedThumbnailUrl } from "../api/trialsApi";

interface PhoneViewportFrameProps {
  currentTarget?: RecallMediaItem;
  onSelectCandidate?: (id: string) => void;
}

type PhoneMode = "home" | "typing" | "results" | "detail";

const SEARCH_BATCH_SIZE = 24;
const SEARCH_HISTORY_KEY = "recall.searchHistory.v1";

function makeMockItem(seed: string, q?: string): RecallMediaItem {
  const thumb = `https://picsum.photos/seed/${encodeURIComponent(seed)}/440/330`;
  const media = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/900`;
  return {
    id: seed,
    metadata: {
      asset: {
        filename: `${seed}.jpg`,
        media_type: "image",
        mime_type: "image/jpeg",
      },
      search: { description: q ?? "Sample library item" },
    },
    links: { media, thumbnail: thumb },
  };
}

function readSearchHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeSearchHistory(nextHistory: string[]) {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory.slice(0, 8)));
}

function rememberSearch(query: string) {
  const normalized = query.trim();
  if (!normalized) return;

  const nextHistory = [
    normalized,
    ...readSearchHistory().filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ];
  writeSearchHistory(nextHistory);
}

function mergeResults(...groups: RecallSearchResult[][]): RecallSearchResult[] {
  const seen = new Set<string>();
  const merged: RecallSearchResult[] = [];

  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

function localSuggestions(query: string, history: string[]): string[] {
  const q = query.trim();
  if (!q) return history.slice(0, 5);

  const lower = q.toLowerCase();
  const historyMatches = history.filter((item) => item.toLowerCase().includes(lower));
  const semanticCompletions = [
    `${q} video`,
    `${q} photo`,
    `${q} meme`,
    `${q} reaction image`,
    `${q} from trip`,
  ];

  return [...historyMatches, ...semanticCompletions]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 6);
}

function refinementSuggestions(query: string, results: RecallMediaItem[]): string[] {
  const q = query.trim();
  if (!q) return [];

  const mediaTypes = new Set(
    results
      .map((item) => item.metadata.asset?.media_type)
      .filter((mediaType) => typeof mediaType === "string"),
  );
  const hasVideos = mediaTypes.has("video");
  const base = [
    q.replace(/\bgif\b/i, "meme"),
    q.replace(/\bphoto\b/i, "video"),
    `${q} close up`,
    `${q} outdoors`,
    `${q} funny reaction`,
  ];

  if (!hasVideos) {
    base.unshift(`${q} video`);
  }

  return base
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== q.toLowerCase())
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 4);
}

function itemTitle(item: RecallMediaItem) {
  return item.metadata.search?.description || item.metadata.asset?.filename || item.id;
}

function itemDateLabel(item: RecallMediaItem) {
  return item.metadata.capture?.date ?? item.metadata.capture?.year_month ?? null;
}

function durationLabel(seconds?: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function PhoneViewportFrame({ currentTarget, onSelectCandidate }: PhoneViewportFrameProps) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<RecallMediaItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SEARCH_BATCH_SIZE);
  const [mode, setMode] = useState<PhoneMode>("home");
  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<RecallMediaItem[]>([]);

  const quickChips = ["waterfall video", "truth nuke gif", "birthday dinner", "dog at beach"];

  useEffect(() => {
    setDetailItem(null);
    setSelectedItems([]);
    setMode((existingMode) => (existingMode === "detail" ? "home" : existingMode));
  }, [currentTarget?.id]);

  useEffect(() => {
    listRecentItems(18)
      .then((response) => {
        if (response.results.length > 0) {
          setResults(response.results);
        }
      })
      .catch(() => {
        setResults(Array.from({ length: 12 }).map((_, index) => makeMockItem(`recent-${index}`)));
      });
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSuggestions(history.slice(0, 5));
      return;
    }

    const timer = window.setTimeout(() => {
      suggestSearches(q, 6)
        .then((response) => {
          const nextSuggestions = [...response.suggestions, ...localSuggestions(q, history)];
          setSuggestions(
            nextSuggestions
              .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
              .slice(0, 6),
          );
        })
        .catch(() => setSuggestions(localSuggestions(q, history)));
    }, 140);

    return () => window.clearTimeout(timer);
  }, [history, query]);

  useEffect(() => {
    const q = query.trim();
    if (!q || mode === "detail") return;

    const timer = window.setTimeout(() => {
      void runSearch(q, SEARCH_BATCH_SIZE, { remember: false });
    }, 560);

    return () => window.clearTimeout(timer);
  }, [query, mode]);

  async function runSearch(
    rawQuery: string,
    count = SEARCH_BATCH_SIZE,
    options: { remember: boolean } = { remember: true },
  ) {
    const q = rawQuery.trim();
    if (!q) {
      setSubmittedQuery("");
      setResults([]);
      setMode("home");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setMode("results");
    setSubmittedQuery(q);
    setVisibleCount(count);

    const [semanticResponse, textResponse] = await Promise.allSettled([
      searchSemantic(q, count),
      searchText(q, Math.min(count, 30)),
    ]);

    const semanticResults = semanticResponse.status === "fulfilled" ? semanticResponse.value.results : [];
    const textResults = textResponse.status === "fulfilled" ? textResponse.value.results : [];
    const nextResults = mergeResults(semanticResults, textResults);

    if (nextResults.length > 0) {
      setResults(nextResults);
    } else if (semanticResponse.status === "rejected" && textResponse.status === "rejected") {
      setResults(Array.from({ length: 9 }).map((_, index) => makeMockItem(`${q}-${index}`, q)));
      setErrorMessage("Backend unavailable. Showing sample tiles until the media bundle is indexed.");
    } else {
      setResults([]);
    }

    if (options.remember) {
      rememberSearch(q);
      setHistory(readSearchHistory());
    }

    setIsLoading(false);
  }

  async function runSimilarSearch(item: RecallMediaItem) {
    setIsLoading(true);
    setErrorMessage(null);
    setMode("results");
    setDetailItem(null);
    setSubmittedQuery("similar items");
    setQuery("");

    try {
      const response = await searchSimilarById(item.id, SEARCH_BATCH_SIZE);
      setResults(response.results);
    } catch {
      setErrorMessage("Similar search is available after this item has an indexed embedding.");
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }

  function openDetail(item: RecallMediaItem) {
    setDetailItem(item);
    setMode("detail");
    onSelectCandidate?.(item.id);
  }

  function toggleSelected(item: RecallMediaItem) {
    setSelectedItems((existing) => {
      if (existing.some((candidate) => candidate.id === item.id)) {
        return existing.filter((candidate) => candidate.id !== item.id);
      }
      return [...existing, item];
    });
  }

  function searchSameDate(item: RecallMediaItem) {
    const date = itemDateLabel(item);
    if (!date) {
      setErrorMessage("This item has no date metadata yet.");
      setMode("results");
      setDetailItem(null);
      return;
    }

    setQuery(date);
    void runSearch(date, SEARCH_BATCH_SIZE);
    setDetailItem(null);
  }

  function sendSelection(item?: RecallMediaItem) {
    const nextSelection = item && !selectedItems.some((candidate) => candidate.id === item.id)
      ? [...selectedItems, item]
      : selectedItems;
    setSelectedItems(nextSelection);
  }

  const refinements = useMemo(() => refinementSuggestions(submittedQuery || query, results), [query, results, submittedQuery]);
  const hasMore = results.length >= visibleCount && mode === "results";

  return (
    <div className="phone-stage">
      <div className="phone-stage-header" aria-hidden="true">
        <div className="mobile-header">
          <div className="recall-logo" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <circle cx="12" cy="12" r="11" fill="var(--ut-gold)" />
              <g fill="#fff">
                <path d="M12 7.2c.9-.9 2.4-.9 3.3 0 .9.9.9 2.4 0 3.3-.9.9-2.4.9-3.3 0-.9-.9-2.4-.9-3.3 0z" />
                <path d="M7.2 12c-.9.9-.9 2.4 0 3.3.9.9 2.4.9 3.3 0 .9-.9.9-2.4 0-3.3-.9-.9-2.4-.9-3.3 0z" />
                <path d="M12 16.8c-.9.9-2.4.9-3.3 0-.9-.9-.9-2.4 0-3.3.9-.9 2.4-.9 3.3 0 .9.9.9 2.4 0 3.3z" />
                <path d="M16.8 12c.9-.9.9-2.4 0-3.3-.9-.9-2.4-.9-3.3 0-.9.9-.9 2.4 0 3.3.9.9 2.4.9 3.3 0z" />
              </g>
            </svg>
          </div>
          <div className="mobile-header-title">Recall</div>
          <div className="phone-stage-size">390 x 844</div>
        </div>
      </div>

      <div className="phone-rect" aria-label="Phone interface viewport">
        <div className="phone-rect-content">
          {mode !== "detail" && (
            <div className="mobile-top">
              <div className="search-bar search-bar--semantic">
                <button className="history-btn" type="button" aria-label="Recent searches">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4.9 8.7A8 8 0 1 1 4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M4 5v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <span className="search-icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <input
                  aria-label="Search your media"
                  value={query}
                  placeholder="Describe a photo, video, or meme"
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    setQuery(nextQuery);
                    setMode(nextQuery.trim() ? "typing" : "home");
                  }}
                  onFocus={() => setMode(query.trim() ? "typing" : "home")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch(query);
                    }
                  }}
                />
                {query ? (
                  <button
                    className="clear-search-btn"
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSubmittedQuery("");
                      setMode("home");
                    }}
                    aria-label="Clear search"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>

              <div className="quick-chips" aria-label="Example searches">
                {quickChips.map((chip) => (
                  <button
                    key={chip}
                    className="chip"
                    type="button"
                    onClick={() => {
                      setQuery(chip);
                      void runSearch(chip);
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "typing" && suggestions.length > 0 && (
            <div className="suggestions">
              <ul>
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      className="suggestion-item"
                      type="button"
                      onClick={() => {
                        setQuery(suggestion);
                        void runSearch(suggestion);
                      }}
                    >
                      <span className="suggestion-icon" aria-hidden>
                        {history.some((item) => item.toLowerCase() === suggestion.toLowerCase()) ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <path d="M4 12a8 8 0 1 0 2.1-5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        )}
                      </span>
                      <span>{suggestion}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(mode === "home" || mode === "results" || mode === "typing") && (
            <div className="grid-wrap">
              {submittedQuery && mode === "results" ? (
                <div className="result-context">
                  <span>{isLoading ? "Searching media" : `${results.length} matches`}</span>
                  <strong>{submittedQuery}</strong>
                </div>
              ) : null}
              {errorMessage ? <div className="search-notice">{errorMessage}</div> : null}

              <div className="grid">
                {isLoading && results.length === 0 ? (
                  <div className="search-loading">
                    <span className="task-loading-spinner" aria-hidden="true" />
                    Searching semantically...
                  </div>
                ) : results.length === 0 ? (
                  <div className="search-empty">No results</div>
                ) : results.map((result) => {
                  const thumb = resolvedThumbnailUrl(result) ?? result.links?.thumbnail ?? result.links?.media;
                  const selected = selectedItems.some((item) => item.id === result.id);
                  const video = isVideo(result);
                  return (
                    <button
                      key={result.id}
                      className={`thumb ${selected ? "thumb--selected" : ""}`}
                      type="button"
                      onClick={() => openDetail(result)}
                      aria-label={`Open ${itemTitle(result)}`}
                    >
                      {thumb ? <img src={thumb} alt={result.metadata.search?.description ?? ""} /> : <span className="thumb-fallback" />}
                      {video ? (
                        <span className="video-badge">
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <path d="M3.5 2.5v7l6-3.5-6-3.5z" fill="currentColor" />
                          </svg>
                          {durationLabel(result.metadata.asset?.duration_seconds) ?? "video"}
                        </span>
                      ) : null}
                      {selected ? (
                        <span className="selected-check" aria-hidden>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {mode === "results" && !isLoading ? (
                <div className="results-footer-card">
                  {hasMore ? (
                    <button
                      className="footer-action"
                      type="button"
                      onClick={() => void runSearch(submittedQuery || query, visibleCount + 20)}
                    >
                      Show more results
                    </button>
                  ) : null}
                  {refinements.length > 0 ? (
                    <div className="refinement-row">
                      <span>Did you mean</span>
                      {refinements.map((refinement) => (
                        <button
                          key={refinement}
                          className="refinement-chip"
                          type="button"
                          onClick={() => {
                            setQuery(refinement);
                            void runSearch(refinement);
                          }}
                        >
                          {refinement}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {mode === "detail" && detailItem && (
            <div className="detail-screen">
              <div className="detail-top">
                <button className="icon-btn" type="button" onClick={() => setMode("results")} aria-label="Back to results">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button className="icon-btn" type="button" onClick={() => toggleSelected(detailItem)} aria-label="Select item">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <div className="detail-media">
                {isVideo(detailItem) && resolvedMediaUrl(detailItem) ? (
                  <video src={resolvedMediaUrl(detailItem) ?? undefined} poster={resolvedThumbnailUrl(detailItem) ?? undefined} controls muted />
                ) : (
                  <img src={resolvedMediaUrl(detailItem) ?? detailItem.links?.media ?? detailItem.links?.thumbnail} alt={itemTitle(detailItem)} />
                )}
              </div>

              <div className="detail-caption">
                <strong>{itemTitle(detailItem)}</strong>
                {itemDateLabel(detailItem) ? <span>{itemDateLabel(detailItem)}</span> : null}
              </div>

              <div className="detail-actions">
                <button className="action" type="button" onClick={() => searchSameDate(detailItem)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M3 8h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <span>Same Date</span>
                </button>

                <button className="action" type="button" onClick={() => void runSimilarSearch(detailItem)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <span>Similar</span>
                </button>

                <button className="action action--primary" type="button" onClick={() => sendSelection(detailItem)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M22 2 11 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    <path d="M22 2 15 22l-4-9-9-4L22 2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Send</span>
                </button>
              </div>
            </div>
          )}

          {selectedItems.length > 0 && (
            <div className="selection-tray" aria-live="polite">
              <div className="selection-thumbs">
                {selectedItems.slice(0, 4).map((item) => (
                  <img key={item.id} src={resolvedThumbnailUrl(item) ?? item.links?.thumbnail ?? item.links?.media} alt="" />
                ))}
              </div>
              <span>{selectedItems.length} selected</span>
              <button className="send-btn" type="button" onClick={() => setSelectedItems([])}>
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
