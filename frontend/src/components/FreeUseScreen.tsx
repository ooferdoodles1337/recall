import type { useSearch } from '../hooks/useSearch'
import PhoneFrame from './PhoneFrame'
import ResultsGrid from './ResultsGrid'
import SearchBar from './SearchBar'

interface Props {
  search: ReturnType<typeof useSearch>
  onBack: () => void
}

// Scaffold for unguided exploration. Keep this separate from TrialScreen so
// guided task metrics are not mixed with free-use behavior.
export default function FreeUseScreen({ search, onBack }: Props) {
  return (
    <div className="TODO min-h-screen">
      <button type="button" onClick={onBack}>
        Back
      </button>
      <PhoneFrame>
        <SearchBar
          query={search.query}
          onChange={search.setQuery}
          isLoading={search.isLoading}
          history={search.history}
          onHistorySelect={search.setQuery}
        />
        <ResultsGrid results={search.results} onSelect={() => undefined} />
      </PhoneFrame>
    </div>
  )
}
