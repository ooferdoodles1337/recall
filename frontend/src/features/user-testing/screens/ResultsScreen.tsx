import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
        <Badge variant="outline" className="results-check-badge" aria-hidden="true">
          <CheckIcon />
        </Badge>

        <div className="results-heading-group">
          <h1 className="results-title">Session Complete</h1>
          <p className="results-subtitle">Thank you for participating in this study.</p>
        </div>

        {results.length > 0 ? (
          <div className="results-trial-list">
            {results.map((r, i) => (
              <Card key={i} className="results-trial-row" size="sm">
                <span className="results-trial-num">{r.trialNumber}</span>
                <span className="results-trial-time">{formatElapsed(r.elapsedMs)}</span>
                {i === bestIdx && <Badge variant="outline" className="results-trial-best">Best</Badge>}
              </Card>
            ))}
            {avg !== null && results.length > 1 && (
              <>
                <Separator />
                <div className="results-avg">
                  <span className="results-avg-label">Average</span>
                  <span className="results-avg-value">{formatElapsed(avg)}</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="results-metrics">
            <Card className="metric-card" size="sm">
              <CardContent className="metric-card-content p-0">
                <span className="metric-value">Done</span>
                <span className="metric-label">Session Status</span>
              </CardContent>
            </Card>
            <Card className="metric-card" size="sm">
              <CardContent className="metric-card-content p-0">
                <span className="metric-value">Guided</span>
                <span className="metric-label">Trial Mode</span>
              </CardContent>
            </Card>
            <Card className="metric-card" size="sm">
              <CardContent className="metric-card-content p-0">
                <span className="metric-value">Debrief</span>
                <span className="metric-label">Next Step</span>
              </CardContent>
            </Card>
          </div>
        )}

        <Button type="button" variant="outline" className="btn-ghost h-auto" onClick={onRestart}>
          <ArrowLeftIcon data-icon="inline-start" />
          Start Over
        </Button>
      </div>
    </main>
  );
}
