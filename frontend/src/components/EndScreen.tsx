interface Props {
  trialCount: number
}

// TODO: "Session complete" screen. Shows trial count. User records results manually.
export default function EndScreen({ trialCount }: Props) {
  return (
    <div className="TODO">
      <p>Done! You completed {trialCount} trials.</p>
    </div>
  )
}
