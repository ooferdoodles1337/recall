import { mediaUrl } from '../api'
import type { MediaItem } from '../types'

interface Props {
  target: MediaItem
  trialIndex: number
  trialCount: number
}

// TODO: left panel of TrialScreen.
// Shows trial counter ("Trial 2 of 8"), "Find this:" label, and the target image.
// No metadata shown — image only, to avoid biasing the search.
export default function TargetPanel({ target, trialIndex, trialCount }: Props) {
  return (
    <div className="TODO">
      <p>Trial {trialIndex + 1} of {trialCount}</p>
      <p>Find this:</p>
      <img src={mediaUrl(target.id)} alt="target" />
    </div>
  )
}
