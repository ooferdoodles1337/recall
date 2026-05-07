export interface UserTestTrialMetrics {
  targetId: string;
  startedAt: string;
  completedAt: string | null;
  searchCount: number;
  clickCount: number;
  elapsedMs: number | null;
}

export interface UserTestSessionMetrics {
  sessionId: string;
  startedAt: string;
  completedAt: string | null;
  trials: UserTestTrialMetrics[];
}

