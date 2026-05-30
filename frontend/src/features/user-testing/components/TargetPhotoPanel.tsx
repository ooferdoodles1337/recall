import { useState } from "react";
import { isVideo, resolvedMediaUrl } from "@/shared/media/mediaItem";
import type { RecallMediaItem } from "@/shared/types/recall";

interface TargetPhotoPanelProps {
  item: RecallMediaItem;
  trialNumber: number;
}

function TargetMedia({ item }: { item: RecallMediaItem }) {
  const [error, setError] = useState(false);
  const mediaUrl = resolvedMediaUrl(item);

  if (error || !mediaUrl) {
    return (
      <div className="target-photo-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span>{error ? "Media unavailable" : "No media"}</span>
      </div>
    );
  }

  if (isVideo(item)) {
    return (
      <video
        key={item.id}
        className="target-photo-img"
        src={mediaUrl}
        autoPlay
        loop
        muted
        playsInline
        onError={() => setError(true)}
      />
    );
  }

  return (
    <img
      key={item.id}
      className="target-photo-img"
      src={mediaUrl}
      alt="Target photo to find"
      onError={() => setError(true)}
    />
  );
}

export function TargetPhotoPanel({ item, trialNumber }: TargetPhotoPanelProps) {
  return (
    <div className="target-panel">
      <div className="target-panel-header">
        <div className="target-header-top">
          <span className="target-trial-number">Trial {trialNumber}</span>
        </div>
        <h2 className="target-panel-heading">Find this photo</h2>
        <p className="target-panel-hint">
          Study the image, then use the phone on the right to search for it. Confirm when found.
        </p>
      </div>

      <div className="target-photo-frame" aria-label="Target media">
        <TargetMedia key={item.id} item={item} />
      </div>
    </div>
  );
}
