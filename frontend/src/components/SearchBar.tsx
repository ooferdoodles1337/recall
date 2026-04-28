interface Props {
  query: string
  onChange: (q: string) => void
  isLoading: boolean
  history: string[]
  onHistorySelect: (q: string) => void
}

// TODO: search input at the top of the phone UI.
// Shows a spinner in the trailing slot while isLoading.
// Shows history chips/pills below the input when query is empty.
export default function SearchBar({ query, onChange, isLoading, history, onHistorySelect }: Props) {
  return (
    <div className="TODO">
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search your photos…"
      />
      {isLoading && <span>…</span>}
      {/* TODO: history chips when query is empty */}
      {!query && history.map((h) => (
        <button key={h} onClick={() => onHistorySelect(h)}>{h}</button>
      ))}
    </div>
  )
}
