import type { useSearch } from '../hooks/useSearch'
import type { MediaItem } from '../types'
import PhoneFrame from './PhoneFrame'
import TargetPanel from './TargetPanel'
import SearchBar from './SearchBar'
import ResultsGrid from './ResultsGrid'

interface Props {
  target: MediaItem
  trialIndex: number
  trialCount: number
  search: ReturnType<typeof useSearch>
  onSelect: (id: string) => void
}

// TODO: main two-panel layout.
// Left (30%): TargetPanel
// Right (70%): PhoneFrame containing SearchBar + ResultsGrid
export default function TrialScreen({ target, trialIndex, trialCount, search, onSelect }: Props) {
  return (
    <div className="TODO flex h-screen">
      <aside className="TODO w-[30%]">
        <TargetPanel target={target} trialIndex={trialIndex} trialCount={trialCount} />
      </aside>
      <main className="TODO flex-1 flex items-center justify-center">
        <PhoneFrame>
          <SearchBar
            query={search.query}
            onChange={search.setQuery}
            isLoading={search.isLoading}
            history={search.history}
            onHistorySelect={search.setQuery}
          />
          <ResultsGrid results={search.results} onSelect={onSelect} />
        </PhoneFrame>
      </main>
    </div>
  )
}
