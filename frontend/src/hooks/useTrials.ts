import { useState, useCallback } from 'react'
import { fetchTrials } from '../api'
import { TRIAL_COUNT } from '../constants'
import type { MediaItem } from '../types'

interface UseTrialsReturn {
  targets: MediaItem[]
  currentIndex: number
  currentTarget: MediaItem | null
  isLoading: boolean
  error: string | null
  loadTrials: () => Promise<void>
  advance: () => void
  isComplete: boolean
}

export function useTrials(): UseTrialsReturn {
  const [targets, setTargets] = useState<MediaItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTrials = useCallback(async () => {
    // TODO: fetch trials, set targets, reset index
    setIsLoading(true)
    setError(null)
    try {
      const items = await fetchTrials(TRIAL_COUNT)
      setTargets(items)
      setCurrentIndex(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trials')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const advance = useCallback(() => {
    // TODO: increment index
    setCurrentIndex((i) => i + 1)
  }, [])

  return {
    targets,
    currentIndex,
    currentTarget: targets[currentIndex] ?? null,
    isLoading,
    error,
    loadTrials,
    advance,
    isComplete: targets.length > 0 && currentIndex >= targets.length,
  }
}
