import type { SessionMetrics } from '../types'

interface Props {
  trialCount: number
  metrics: SessionMetrics | null
  onFreeUse: () => void
  onRestart: () => void
}

// TODO: "Session complete" screen. Style the summary and export controls.
export default function EndScreen({ trialCount, metrics, onFreeUse, onRestart }: Props) {
  const completedTrials = metrics?.trials.filter((trial) => trial.completedAtMs != null) ?? []
  const averageDurationMs = completedTrials.length
    ? Math.round(completedTrials.reduce((sum, trial) => sum + (trial.durationMs ?? 0), 0) / completedTrials.length)
    : 0

  return (
    <div className="TODO">
      <p>Done! You completed {trialCount} trials.</p>
      {metrics && (
        <>
          <p>Session ID: {metrics.sessionId}</p>
          <p>Average target-find time: {averageDurationMs} ms</p>
          <p>Total searches: {metrics.trials.reduce((sum, trial) => sum + trial.searchCount, 0)}</p>
          <p>Total wrong selections: {metrics.trials.reduce((sum, trial) => sum + trial.wrongSelectionCount, 0)}</p>
          <details>
            <summary>Raw metrics JSON</summary>
            <pre>{JSON.stringify(metrics, null, 2)}</pre>
          </details>
        </>
      )}
      <button type="button" onClick={onRestart}>Restart guided demo</button>
      <button type="button" onClick={onFreeUse}>Try Recall freely</button>
    </div>
  )
}
