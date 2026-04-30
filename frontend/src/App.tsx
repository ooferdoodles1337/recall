import { useCallback, useEffect, useState } from 'react'
import { useTrials } from './hooks/useTrials'
import { useSearch } from './hooks/useSearch'
import { useSessionMetrics } from './hooks/useSessionMetrics'
import StartScreen from './components/StartScreen'
import TrialScreen from './components/TrialScreen'
import ResultFlash from './components/ResultFlash'
import EndScreen from './components/EndScreen'
import type { AppState } from './types'
import { RESULT_FLASH_DURATION_MS } from './constants'
import FreeUseScreen from './components/FreeUseScreen'

export default function App() {
  const [appState, setAppState] = useState<AppState>('start')
  const trials = useTrials()
  const {
    metrics,
    startSession,
    startTrial,
    recordSearch,
    recordSelection,
    finishSession,
    resetMetrics,
  } = useSessionMetrics()

  const handleSearchComplete = useCallback((event: { query: string; resultCount: number }) => {
    if (appState !== 'trial' || !trials.currentTarget) return
    recordSearch(trials.currentIndex, trials.currentTarget.id, event.query, event.resultCount)
  }, [appState, recordSearch, trials.currentIndex, trials.currentTarget])

  const search = useSearch(handleSearchComplete)

  // Advance from result_flash → next trial or end
  useEffect(() => {
    if (appState !== 'result_flash') return
    const timer = setTimeout(() => {
      const nextIndex = trials.currentIndex + 1
      if (nextIndex >= trials.targets.length) {
        void finishSession()
        setAppState('end')
        return
      }

      trials.advance()
      search.reset()
      startTrial(nextIndex, trials.targets[nextIndex].id)
      setAppState('trial')
    }, RESULT_FLASH_DURATION_MS)
    return () => clearTimeout(timer)
  }, [
    appState,
    finishSession,
    search.reset,
    startTrial,
    trials.currentIndex,
    trials.targets,
    trials.advance,
  ])

  const handleStart = async () => {
    resetMetrics()
    search.reset()
    const targets = await trials.loadTrials()
    if (targets.length === 0) return
    startSession(targets)
    startTrial(0, targets[0].id)
    setAppState('trial')
  }

  const handleFreeUse = () => {
    search.reset()
    setAppState('free_use')
  }

  const handleResultSelect = (selectedId: string) => {
    if (!trials.currentTarget) return

    const isCorrect = selectedId === trials.currentTarget.id
    recordSelection(trials.currentIndex, trials.currentTarget.id, selectedId, isCorrect)
    if (isCorrect) {
      setAppState('result_flash')
    }
    // Wrong-click feedback is handled inside ResultsGrid via a callback
  }

  if (appState === 'start') {
    return (
      <StartScreen
        onStart={handleStart}
        onFreeUse={handleFreeUse}
        isLoading={trials.isLoading}
        error={trials.error}
      />
    )
  }

  if (appState === 'free_use') {
    return <FreeUseScreen search={search} onBack={() => setAppState('start')} />
  }

  if (appState === 'end') {
    return (
      <EndScreen
        trialCount={trials.targets.length}
        metrics={metrics}
        onFreeUse={handleFreeUse}
        onRestart={handleStart}
      />
    )
  }

  return (
    <>
      <TrialScreen
        target={trials.currentTarget!}
        trialIndex={trials.currentIndex}
        trialCount={trials.targets.length}
        search={search}
        onSelect={handleResultSelect}
      />
      {appState === 'result_flash' && <ResultFlash />}
    </>
  )
}
