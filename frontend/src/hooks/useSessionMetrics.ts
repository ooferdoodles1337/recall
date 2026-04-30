import { useCallback, useMemo, useRef, useState } from 'react'
import { submitSessionMetrics } from '../api'
import type { MediaItem, SessionMetrics, TrialMetric } from '../types'

function createSessionId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function nowMs(): number {
  return Math.round(performance.now())
}

function createTrialMetric(trialIndex: number, targetId: string, startedAtMs: number): TrialMetric {
  return {
    trialIndex,
    targetId,
    startedAtMs,
    searchCount: 0,
    selectionCount: 0,
    wrongSelectionCount: 0,
  }
}

export function useSessionMetrics() {
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null)
  const sessionStartMsRef = useRef(0)

  const startSession = useCallback((targets: MediaItem[]) => {
    sessionStartMsRef.current = nowMs()
    const session: SessionMetrics = {
      sessionId: createSessionId(),
      startedAtIso: new Date().toISOString(),
      targetIds: targets.map((target) => target.id),
      events: [],
      trials: [],
    }
    setMetrics(session)
    return session
  }, [])

  const startTrial = useCallback((trialIndex: number, targetId: string) => {
    const atMs = nowMs() - sessionStartMsRef.current
    setMetrics((current) => {
      if (!current) return current
      const existing = current.trials.find((trial) => trial.trialIndex === trialIndex)
      if (existing) return current

      return {
        ...current,
        events: [
          ...current.events,
          { type: 'trial_start', atMs, trialIndex, targetId },
        ],
        trials: [
          ...current.trials,
          createTrialMetric(trialIndex, targetId, atMs),
        ],
      }
    })
  }, [])

  const recordSearch = useCallback((trialIndex: number, targetId: string, query: string, resultCount: number) => {
    const atMs = nowMs() - sessionStartMsRef.current
    setMetrics((current) => {
      if (!current) return current
      return {
        ...current,
        events: [
          ...current.events,
          { type: 'search', atMs, trialIndex, targetId, query, resultCount },
        ],
        trials: current.trials.map((trial) => trial.trialIndex === trialIndex
          ? { ...trial, searchCount: trial.searchCount + 1, finalQuery: query }
          : trial
        ),
      }
    })
  }, [])

  const recordSelection = useCallback((trialIndex: number, targetId: string, selectedId: string, isCorrect: boolean) => {
    const atMs = nowMs() - sessionStartMsRef.current
    setMetrics((current) => {
      if (!current) return current
      return {
        ...current,
        events: [
          ...current.events,
          { type: 'selection', atMs, trialIndex, targetId, selectedId, isCorrect },
        ],
        trials: current.trials.map((trial) => {
          if (trial.trialIndex !== trialIndex) return trial
          const completedFields = isCorrect
            ? { completedAtMs: atMs, durationMs: atMs - trial.startedAtMs }
            : {}
          return {
            ...trial,
            ...completedFields,
            selectionCount: trial.selectionCount + 1,
            wrongSelectionCount: trial.wrongSelectionCount + (isCorrect ? 0 : 1),
          }
        }),
      }
    })
  }, [])

  const finishSession = useCallback(async () => {
    if (!metrics) return null

    const finished = { ...metrics, completedAtIso: new Date().toISOString() }
    setMetrics(finished)
    await submitSessionMetrics(finished)
    return finished
  }, [metrics])

  const resetMetrics = useCallback(() => {
    sessionStartMsRef.current = 0
    setMetrics(null)
  }, [])

  return useMemo(() => ({
    metrics,
    startSession,
    startTrial,
    recordSearch,
    recordSelection,
    finishSession,
    resetMetrics,
  }), [finishSession, metrics, recordSearch, recordSelection, resetMetrics, startSession, startTrial])
}
