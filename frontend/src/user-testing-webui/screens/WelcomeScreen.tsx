interface WelcomeScreenProps {
  onStartTrial: () => void;
}

export function WelcomeScreen({ onStartTrial }: WelcomeScreenProps) {
  return (
    <main className="welcome-shell">
      <div className="welcome-content">
        <header className="welcome-header">
          <span className="ut-eyebrow">Recall</span>
          <h1 className="welcome-title">User Testing Session</h1>
          <p className="welcome-subtitle">
            Welcome! This session takes about 10 minutes. You'll use a phone
            interface to search for photos — no preparation needed.
          </p>
        </header>

        <div className="welcome-actions">
          <button className="action-card action-card--primary" onClick={onStartTrial}>
            <span className="action-card-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="action-card-body">
              <span className="action-card-title">Start Guided Trial</span>
              <span className="action-card-desc">Walk through instructions, then complete photo-finding tasks</span>
            </span>
            <span className="action-card-arrow" aria-hidden="true">→</span>
          </button>

          <button
            className="action-card action-card--secondary"
            onClick={() => { window.location.href = "/phone"; }}
          >
            <span className="action-card-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2.5" />
              </svg>
            </span>
            <span className="action-card-body">
              <span className="action-card-title">Open Phone Tester</span>
              <span className="action-card-desc">Freely explore the phone interface without a guided task</span>
            </span>
            <span className="action-card-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </main>
  );
}
