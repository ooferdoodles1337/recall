export type UserTestScreen = "welcome" | "task" | "results";

export type TrialPhase = "idle" | "active";

export interface TrialResult {
  trialNumber: number;
  targetId: string;
  selectedId: string | null;
  elapsedMs: number;
  timestamp: string;
}
