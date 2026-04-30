import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSearch } from '../api'
import { SEARCH_DEBOUNCE_MS } from '../constants'
import type { SearchResult } from '../types'

interface UseSearchReturn {
  query: string
  setQuery: (q: string) => void
  results: SearchResult[]
  isLoading: boolean
  history: string[]       // past queries this trial, most recent first
  clearHistory: () => void
  reset: () => void       // call at the start of each new trial
}

interface SearchCompleteEvent {
  query: string
  resultCount: number
}

export function useSearch(onSearchComplete?: (event: SearchCompleteEvent) => void): UseSearchReturn {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearchCompleteRef = useRef(onSearchComplete)

  useEffect(() => {
    onSearchCompleteRef.current = onSearchComplete
  }, [onSearchComplete])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    // TODO: debounce, fire search, update results and history
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const trimmedQuery = query.trim()
        const res = await fetchSearch(trimmedQuery)
        setResults(res)
        setHistory((prev) => [trimmedQuery, ...prev.filter((h) => h !== trimmedQuery)])
        onSearchCompleteRef.current?.({ query: trimmedQuery, resultCount: res.length })
      } catch {
        // TODO: surface error state
      } finally {
        setIsLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const clearHistory = useCallback(() => setHistory([]), [])

  const reset = useCallback(() => {
    setQuery('')
    setResults([])
    setHistory([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  return useMemo(() => ({
    query,
    setQuery,
    results,
    isLoading,
    history,
    clearHistory,
    reset,
  }), [clearHistory, history, isLoading, query, reset, results])
}
