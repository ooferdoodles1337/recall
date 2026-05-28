import { recallFetch } from "@/shared/api/client";
import type { RecallMediaItem } from "@/shared/types/recall";

export interface TrialsResponse {
  n: number;
  targets: RecallMediaItem[];
}

export function fetchTrials(n = 10) {
  return recallFetch<TrialsResponse>(`/trials?n=${n}`);
}
