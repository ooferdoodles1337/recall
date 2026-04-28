interface Props {
  onStart: () => void
  isLoading: boolean
  error: string | null
}

// TODO: full-screen welcome. Brief task instructions. "Begin" button triggers onStart.
export default function StartScreen({ onStart, isLoading, error }: Props) {
  return (
    <div className="TODO">
      {error && <p>{error}</p>}
      <button onClick={onStart} disabled={isLoading}>
        {isLoading ? 'Loading…' : 'Begin'}
      </button>
    </div>
  )
}
