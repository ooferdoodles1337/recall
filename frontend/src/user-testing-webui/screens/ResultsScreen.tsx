interface ResultsScreenProps {
  onRestart: () => void;
}

export function ResultsScreen({ onRestart }: ResultsScreenProps) {
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

        <div className="results-metrics">
          <div className="metric-card">
            <span className="metric-value">—</span>
            <span className="metric-label">Tasks Completed</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">—</span>
            <span className="metric-label">Avg. Time</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">—</span>
            <span className="metric-label">Accuracy</span>
          </div>
        </div>

        <button className="btn-ghost" onClick={onRestart}>← Start Over</button>
      </div>
    </main>
  );
}
