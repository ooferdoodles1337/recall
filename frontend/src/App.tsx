import { useState, useEffect } from 'react'
import { useTrials } from './hooks/useTrials'
import { useSearch } from './hooks/useSearch'
import StartScreen from './components/StartScreen'
import TrialScreen from './components/TrialScreen'
import ResultFlash from './components/ResultFlash'
import EndScreen from './components/EndScreen'
import type { AppState } from './types'
import { RESULT_FLASH_DURATION_MS } from './constants'

export default function App() {
  const [appState, setAppState] = useState<AppState>('start')
  const trials = useTrials()
  const search = useSearch()

  // Advance from result_flash → next trial or end
  useEffect(() => {
    if (appState !== 'result_flash') return
    const timer = setTimeout(() => {
      trials.advance()
      search.reset()
      setAppState(trials.isComplete ? 'end' : 'trial')
    }, RESULT_FLASH_DURATION_MS)
    return () => clearTimeout(timer)
  }, [appState]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    await trials.loadTrials()
    setAppState('trial')
  }

  const handleResultSelect = (selectedId: string) => {
    // TODO: check if selectedId matches trials.currentTarget?.id
    // If match → 'result_flash', else flash red border on the selected tile
    if (selectedId === trials.currentTarget?.id) {
      setAppState('result_flash')
    }
    // Wrong-click feedback is handled inside ResultsGrid via a callback
  }

  if (appState === 'start') {
    return <StartScreen onStart={handleStart} isLoading={trials.isLoading} error={trials.error} />
  }

  if (appState === 'end') {
    return <EndScreen trialCount={trials.targets.length} />
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
