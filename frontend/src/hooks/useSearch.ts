import { useState, useEffect, useRef } from 'react'
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

export function useSearch(): UseSearchReturn {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        const res = await fetchSearch(query.trim())
        setResults(res)
        setHistory((prev) => [query.trim(), ...prev.filter((h) => h !== query.trim())])
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

  const clearHistory = () => setHistory([])

  const reset = () => {
    setQuery('')
    setResults([])
    setHistory([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  return { query, setQuery, results, isLoading, history, clearHistory, reset }
}
