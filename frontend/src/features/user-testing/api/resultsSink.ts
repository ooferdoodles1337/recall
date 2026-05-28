import type { UserTestSessionMetrics } from "../metrics/types";

export interface ResultsSink {
  submit(metrics: UserTestSessionMetrics): Promise<void>;
}

export class NoopResultsSink implements ResultsSink {
  async submit(_metrics: UserTestSessionMetrics): Promise<void> {
    return Promise.resolve();
  }
}

