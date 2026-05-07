interface InstructionsScreenProps {
  onBack: () => void;
  onBegin: () => void;
}

const STEPS = [
  {
    number: 1,
    title: "You'll be shown a photo",
    desc: "A target photo will appear on the left side of your screen. Take a moment to study it — notice details like subject, location, or time of day.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    number: 2,
    title: "Use the phone interface to find it",
    desc: "On the right, you'll see a phone-sized interface for the Recall app. Search for the photo by typing keywords, dates, or descriptions — just as you would on your own phone.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    number: 3,
    title: "Tap the matching result",
    desc: "When you spot the matching photo in the results, tap it to select it as your answer. Try to be as accurate as you can — take your time.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
] as const;

export function InstructionsScreen({ onBack, onBegin }: InstructionsScreenProps) {
  return (
    <main className="instructions-shell">
      <div className="instructions-content">
        <header className="instructions-header">
          <span className="ut-eyebrow">How it works</span>
          <h1 className="instructions-title">What to expect</h1>
          <p className="instructions-subtitle">Three simple steps — no experience needed.</p>
        </header>

        <ol className="steps-list">
          {STEPS.map((step) => (
            <li key={step.number} className="step-item">
              <span className="step-number">{step.number}</span>
              <span className="step-icon" aria-hidden="true">{step.icon}</span>
              <div className="step-body">
                <h2 className="step-title">{step.title}</h2>
                <p className="step-desc">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <footer className="instructions-footer">
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" onClick={onBegin}>Begin Task →</button>
        </footer>
      </div>
    </main>
  );
}
