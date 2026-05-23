import { useEffect, useMemo, useState } from "react";
import type { RecallMediaItem } from "../../shared/types/recall";
import { searchText } from "../../phone-tester-ui/api/searchApi";
import { resolvedThumbnailUrl, resolvedMediaUrl } from "../api/trialsApi";

interface PhoneViewportFrameProps {
  currentTarget?: RecallMediaItem;
  onSelectCandidate?: (id: string) => void;
}

function makeMockItem(seed: string, q?: string): RecallMediaItem {
  const thumb = `https://picsum.photos/seed/${encodeURIComponent(seed)}/440/330`;
  const media = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/900`;
  return {
    id: seed,
    metadata: {
      search: { description: q ?? "" },
    },
    links: { media, thumbnail: thumb },
  };
}

export function PhoneViewportFrame({ currentTarget, onSelectCandidate }: PhoneViewportFrameProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecallMediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"home" | "search" | "results" | "detail">("home");
  const [detailItem, setDetailItem] = useState<RecallMediaItem | null>(null);
  const [sentItems, setSentItems] = useState<RecallMediaItem[]>([]);

  const quickChips = ["pets", "food", "vacation", "friends"];

  useEffect(() => {
    // show favorites on load (home state)
    const favs = Array.from({ length: 12 }).map((_, i) => makeMockItem(`fav-${i}`));
    setResults(favs);
  }, []);

  function suggestionsFor(q: string) {
    if (!q) return [] as string[];
    return [
      `${q} movie poster`,
      `${q} smiling suggestively gif`,
      `${q} and Donkey`,
      `${q} sitting in bath`,
      `${q} taking photo`,
      `More...`,
    ];
  }

  function runSearch(q: string) {
    if (!q) {
      setResults([]);
      setMode("results");
      return;
    }

    setIsLoading(true);
    // Try backend text search first, fall back to mocked picsum thumbnails.
    searchText(q)
      .then((res) => {
        // server returns { query, results }
        setResults(res.results ?? []);
        setMode("results");
      })
      .catch(() => {
        // fallback deterministic mock
        const base = q || "random";
        const out = Array.from({ length: 9 }).map((_, i) => makeMockItem(`${base}-${i}`, q));
        setResults(out);
        setMode("results");
      })
      .finally(() => setIsLoading(false));
  }

  function openDetail(item: RecallMediaItem) {
    setDetailItem(item);
    setMode("detail");
    // notify testing harness of selection attempt (TaskScreen will decide correctness)
    onSelectCandidate?.(item.id);
  }

  function searchSimilar(item: RecallMediaItem) {
    runSearch(`similar-${item.id}`);
  }

  function searchSameDate(item: RecallMediaItem) {
    runSearch(`date-${item.id}`);
  }

  function sendItem(item: RecallMediaItem) {
    setSentItems((s) => [item, ...s]);
  }

  const suggestions = useMemo(() => suggestionsFor(query), [query]);

  return (
    <div className="phone-stage">
      <div className="phone-stage-header" aria-hidden="true">
        <div className="mobile-header">
          <div className="recall-logo" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <circle cx="12" cy="12" r="11" fill="var(--ut-gold)" />
              <g fill="#fff">
                <path d="M12 7.2c.9-.9 2.4-.9 3.3 0 .9.9.9 2.4 0 3.3-.9.9-2.4.9-3.3 0-.9-.9-.9-2.4 0-3.3z" />
                <path d="M7.2 12c-.9.9-.9 2.4 0 3.3.9.9 2.4.9 3.3 0 .9-.9.9-2.4 0-3.3-.9-.9-2.4-.9-3.3 0z" />
                <path d="M12 16.8c-.9.9-2.4.9-3.3 0-.9-.9-.9-2.4 0-3.3.9-.9 2.4-.9 3.3 0 .9.9.9 2.4 0 3.3z" />
                <path d="M16.8 12c.9-.9.9-2.4 0-3.3-.9-.9-2.4-.9-3.3 0-.9.9-.9 2.4 0 3.3.9.9 2.4.9 3.3 0z" />
              </g>
            </svg>
          </div>
          <div className="mobile-header-title">Recall</div>
          <div className="phone-stage-size">390 × 844</div>
        </div>
      </div>

      <div className="phone-rect" aria-label="Phone interface viewport">
        <div className="phone-rect-content">
          <div className="mobile-top">
            <div className="search-bar">
              <span className="search-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 21l-4.35-4.35" stroke="#9AA6B2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="11" cy="11" r="6" stroke="#9AA6B2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
              <input
                aria-label="Search"
                value={query}
                placeholder="Search"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMode(e.target.value ? "search" : "home");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    runSearch(query || "");
                  }
                }}
              />
              {query ? (
                <button className="btn-ghost btn-ghost--sm" onClick={() => { setQuery(""); setMode("home"); }} aria-label="Clear search">✕</button>
              ) : (
                <button className="mic-btn" aria-hidden title="Voice search">🎤</button>
              )}
            </div>

            <div className="quick-chips">
              {quickChips.map((c) => (
                <button key={c} className="chip" onClick={() => { setQuery(c); runSearch(c); }}>{c}</button>
              ))}
            </div>
          </div>

          {mode === "search" && suggestions.length > 0 && (
            <div className="suggestions">
              <div className="suggestions-label">SUGGESTIONS</div>
              <ul>
                {suggestions.map((s) => (
                  <li key={s}>
                    <button className="suggestion-item" onClick={() => { setQuery(s); runSearch(s); }}>{s}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(mode === "home" || mode === "results") && (
            <div className="grid-wrap">
              <div className="grid">
                {isLoading ? (
                  <div className="search-loading">Searching…</div>
                ) : results.length === 0 ? (
                  <div className="search-empty">No results</div>
                ) : results.map((r) => (
                  <button
                    key={r.id}
                    className="thumb"
                    onClick={() => openDetail(r)}
                    aria-label={`Open ${r.id}`}
                  >
                    <img src={resolvedThumbnailUrl(r) ?? r.links?.thumbnail ?? r.links?.media} alt={r.metadata?.search?.description ?? ""} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "detail" && detailItem && (
            <div className="detail-screen">
              <div className="detail-top">
                <button className="btn-ghost btn-ghost--sm" onClick={() => { setMode("results"); setDetailItem(null); }} aria-label="Back">←</button>
                <div />
                <button className="btn-ghost btn-ghost--sm" aria-label="More">⋯</button>
              </div>

              <div className="detail-media">
                <img src={resolvedMediaUrl(detailItem) ?? detailItem.links?.media ?? detailItem.links?.thumbnail} alt="Detail" />
              </div>

              <div className="detail-actions">
                <button className="action" onClick={() => searchSameDate(detailItem)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="#33413d" strokeWidth="1.25"/><path d="M3 8h18" stroke="#33413d" strokeWidth="1.25" strokeLinecap="round"/></svg>
                  <span>Search Same Date</span>
                </button>

                <button className="action" onClick={() => searchSimilar(detailItem)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6" stroke="#33413d" strokeWidth="1.25"/><path d="M21 21l-4.35-4.35" stroke="#33413d" strokeWidth="1.25" strokeLinecap="round"/></svg>
                  <span>Search Similar</span>
                </button>

                <button className="action" onClick={() => sendItem(detailItem)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="#33413d" strokeWidth="1.25" strokeLinecap="round"/><path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="#33413d" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span>Send</span>
                </button>
              </div>
            </div>
          )}

          {sentItems.length > 0 && (
            <div className="sent-list" aria-live="polite">
              <strong>Sent</strong>
              <div className="sent-row">
                {sentItems.map((s) => (
                  <img key={s.id} src={resolvedThumbnailUrl(s) ?? s.links?.thumbnail} alt="sent" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
