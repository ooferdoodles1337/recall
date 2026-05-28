import { ArrowRightIcon, PlayCircleIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

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
          <Button
            type="button"
            variant="ghost"
            className="action-card action-card--primary h-auto"
            onClick={onStartTrial}
          >
            <span className="action-card-icon">
              <PlayCircleIcon data-icon="inline-start" />
            </span>
            <span className="action-card-body">
              <span className="action-card-title">Start Trial</span>
              <span className="action-card-desc">Begin timed photo-finding tasks</span>
            </span>
            <ArrowRightIcon className="action-card-arrow" aria-hidden="true" data-icon="inline-end" />
          </Button>

          <Button
            asChild
            variant="outline"
            className="action-card action-card--secondary h-auto"
          >
            <a href="/phone">
              <span className="action-card-icon">
                <SmartphoneIcon data-icon="inline-start" />
              </span>
              <span className="action-card-body">
                <span className="action-card-title">Open Phone Tester</span>
                <span className="action-card-desc">Freely explore the phone interface without a guided task</span>
              </span>
              <ArrowRightIcon className="action-card-arrow" aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}
