import type { UserTestSessionMetrics } from "./types";

export function createEmptySessionMetrics(): UserTestSessionMetrics {
  return {
    sessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    trials: [],
  };
}

