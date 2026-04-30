import { thumbnailUrl } from '../api'
import type { SearchResult } from '../types'

interface Props {
  results: SearchResult[]
  onSelect: (id: string) => void
}

// TODO: 3-column image grid inside the phone frame.
// Clicking a tile calls onSelect(id).
// If the selection is wrong, the tile flashes a red border briefly.
// Correct selection is determined by App.tsx (onSelect triggers the check).
export default function ResultsGrid({ results, onSelect }: Props) {
  const handleClick = (id: string) => {
    onSelect(id)
    // TODO: App.tsx will call back with whether it was correct.
    // For now the red-flash logic needs a way to know — consider passing
    // an `isCorrect` prop or a callback that returns boolean.
  }

  return (
    <div className="TODO grid grid-cols-3 gap-0.5">
      {results.map((r) => (
        <button
          key={r.id}
          onClick={() => handleClick(r.id)}
          className="TODO"
        >
          <img src={thumbnailUrl(r.id)} alt={r.metadata.filename} className="aspect-square object-cover w-full" />
        </button>
      ))}
    </div>
  )
}
