interface Props {
  onStart: () => void
  onFreeUse: () => void
  isLoading: boolean
  error: string | null
}

// TODO: full-screen welcome. Brief task instructions. "Begin" button triggers onStart.
export default function StartScreen({ onStart, onFreeUse, isLoading, error }: Props) {
  return (
    <div className="TODO">
      <p>
        In the guided demo, you will be shown target photos and asked to find each one with Recall.
      </p>
      {error && <p>{error}</p>}
      <button onClick={onStart} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Start Demo'}
      </button>
      <button type="button" onClick={onFreeUse} disabled={isLoading}>
        Try Recall Freely
      </button>
    </div>
  )
}
