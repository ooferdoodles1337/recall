import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, SearchIcon, TimerIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface InstructionsScreenProps {
  onBack: () => void;
  onBegin: () => void;
}

const STEPS = [
  {
    number: 1,
    title: "Start a timed search",
    desc: "Press Begin Task when you're ready. The timer starts as soon as the phone interface opens.",
    icon: TimerIcon,
  },
  {
    number: 2,
    title: "Use the phone interface",
    desc: "Search by typing keywords, dates, or descriptions, just as you would on your own phone.",
    icon: SearchIcon,
  },
  {
    number: 3,
    title: "Confirm your answer",
    desc: "When you spot the result you want to submit, tap it and confirm. Your time is recorded for the session.",
    icon: CheckCircleIcon,
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
              <Badge variant="outline" className="step-number">{step.number}</Badge>
              <span className="step-icon" aria-hidden="true">
                <step.icon />
              </span>
              <div className="step-body">
                <h2 className="step-title">{step.title}</h2>
                <p className="step-desc">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <footer className="instructions-footer">
          <Button type="button" variant="outline" className="btn-ghost h-auto" onClick={onBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
          <Button type="button" className="btn-primary h-auto" onClick={onBegin}>
            Begin Task
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </footer>
      </div>
    </main>
  );
}
