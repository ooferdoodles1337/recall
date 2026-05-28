import type { TrialResult } from "../types";

interface ResultsScreenProps {
  results: TrialResult[];
  onRestart: () => void;
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(1)}s`;
}

export function ResultsScreen({ results, onRestart }: ResultsScreenProps) {
  const bestIdx = results.length > 1
    ? results.reduce((best, r, i) => r.elapsedMs < results[best].elapsedMs ? i : best, 0)
    : -1;
  const avg = results.length > 0
    ? results.reduce((sum, r) => sum + r.elapsedMs, 0) / results.length
    : null;

  return (
    <main className="results-shell">
      <div className="results-content">
        <div className="results-check-badge" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <div className="results-heading-group">
          <h1 className="results-title">Session Complete</h1>
          <p className="results-subtitle">Thank you for participating in this study.</p>
        </div>

        {results.length > 0 ? (
          <div className="results-trial-list">
            {results.map((r, i) => (
              <div key={i} className="results-trial-row">
                <span className="results-trial-num">{r.trialNumber}</span>
                <span className="results-trial-time">{formatElapsed(r.elapsedMs)}</span>
                {i === bestIdx && <span className="results-trial-best">Best</span>}
              </div>
            ))}
            {avg !== null && results.length > 1 && (
              <div className="results-avg">
                <span className="results-avg-label">Average</span>
                <span className="results-avg-value">{formatElapsed(avg)}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="results-metrics">
            <div className="metric-card">
              <span className="metric-value">Done</span>
              <span className="metric-label">Session Status</span>
            </div>
            <div className="metric-card">
              <span className="metric-value">Guided</span>
              <span className="metric-label">Trial Mode</span>
            </div>
            <div className="metric-card">
              <span className="metric-value">Debrief</span>
              <span className="metric-label">Next Step</span>
            </div>
          </div>
        )}

        <button className="btn-ghost" onClick={onRestart}>← Start Over</button>
      </div>
    </main>
  );
}
