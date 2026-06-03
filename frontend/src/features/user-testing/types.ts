export type UserTestScreen = "welcome" | "task";

export interface TrialResult {
  trialNumber: number;
  targetId: string;
  selectedId: string | null;
  elapsedMs: number;
  timestamp: string;
}
