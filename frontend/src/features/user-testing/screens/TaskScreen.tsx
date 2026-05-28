import { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PhoneViewportFrame } from "@/features/phone/components/PhoneViewportFrame";
import type { TrialResult } from "../types";

const RESULTS_KEY = "recall.trialResults.v1";

function loadStoredResults(): TrialResult[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RESULTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(1)}s`;
}

interface TaskScreenProps {
  onExit: (results: TrialResult[]) => void;
}

export function TaskScreen({ onExit }: TaskScreenProps) {
  const [phase, setPhase] = useState<"idle" | "active">("idle");
  const [results, setResults] = useState<TrialResult[]>(() => loadStoredResults());
  const [isStarting, setIsStarting] = useState(false);
  const startMsRef = useRef<number | null>(null);

  const handleStart = useCallback(async () => {
    setIsStarting(true);
    try {
      startMsRef.current = Date.now();
      setPhase("active");
    } catch (err) {
      console.error("[Recall Trial] Failed to start:", err);
    } finally {
      setIsStarting(false);
    }
  }, []);

  const handleConfirm = useCallback((selectedId: string) => {
    const elapsed = startMsRef.current !== null ? Date.now() - startMsRef.current : 0;
    setResults((prev) => {
      const result: TrialResult = {
        trialNumber: prev.length + 1,
        targetId: "free",
        selectedId,
        elapsedMs: elapsed,
        timestamp: new Date().toISOString(),
      };
      const next = [...prev, result];
      localStorage.setItem(RESULTS_KEY, JSON.stringify(next));
      console.log("[Recall Trial]", result);
      return next;
    });

    startMsRef.current = null;
    setPhase("idle");
  }, []);

  if (phase === "active") {
    return (
      <div className="task-phone-only">
        <PhoneViewportFrame onConfirmAnswer={handleConfirm} />
      </div>
    );
  }

  const bestIdx = results.length > 1
    ? results.reduce((best, r, i) => r.elapsedMs < results[best].elapsedMs ? i : best, 0)
    : -1;

  return (
    <main className="trial-idle-shell">
      <div className="trial-idle-content">
        <div className="trial-idle-left">
          <span className="ut-eyebrow">Recall — User Study</span>
          <h1 className="trial-idle-title">
            {results.length === 0 ? "Ready when\nyou are." : "Trial complete."}
          </h1>
          <p className="trial-idle-desc">
            {results.length === 0
              ? "When you press Start, the timer begins. Use the Recall app to find the target, then confirm your answer. Your time is measured from the moment you press Start."
              : `${results.length} trial${results.length !== 1 ? "s" : ""} recorded this session. Press Start for another trial, or finish the session.`}
          </p>
          <div className="trial-idle-actions">
            <Button
              size="lg"
              disabled={isStarting}
              onClick={handleStart}
              className="trial-start-btn"
            >
              {isStarting ? "Loading…" : results.length === 0 ? "Start Trial" : "Start Next Trial"}
            </Button>
            {results.length > 0 && (
              <Button
                variant="outline"
                onClick={() => onExit(results)}
                className="trial-exit-btn"
              >
                Finish Session
              </Button>
            )}
          </div>
        </div>

        <div className="trial-idle-right">
          <Card className="trial-times-card">
            <CardHeader>
              <CardTitle className="trial-times-title">
                Trial Times
                {results.length > 0 && (
                  <Badge variant="outline" className="trial-count-badge">
                    {results.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {results.length === 0 ? (
                <div className="trial-times-empty">
                  No trials yet — press Start to begin.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14 font-mono text-xs">#</TableHead>
                      <TableHead className="font-mono text-xs">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.trialNumber}
                        </TableCell>
                        <TableCell>
                          <span className="trial-time-value">{formatElapsed(r.elapsedMs)}</span>
                          {i === bestIdx && (
                            <Badge variant="outline" className="trial-best-badge">Best</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {results.length > 1 && (
                <>
                  <Separator />
                  <div className="trial-avg px-4 py-3">
                    <span className="results-avg-label">Average</span>
                    <span className="results-avg-value">
                      {formatElapsed(results.reduce((sum, r) => sum + r.elapsedMs, 0) / results.length)}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
