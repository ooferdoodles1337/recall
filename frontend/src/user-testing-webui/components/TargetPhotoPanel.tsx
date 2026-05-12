import { useState } from "react";
import * as Progress from "@radix-ui/react-progress";
import type { RecallMediaItem } from "../../shared/types/recall";
import { isVideo, resolvedMediaUrl } from "../api/trialsApi";

interface TargetPhotoPanelProps {
  item: RecallMediaItem;
  taskNumber: number;
  totalTasks: number;
  onNext: () => void;
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

  if (isVideo(item) && mediaUrl) {
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

  if (!mediaUrl) {
    return (
      <div className="target-photo-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span>No media</span>
      </div>
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

export function TargetPhotoPanel({ item, taskNumber, totalTasks, onNext }: TargetPhotoPanelProps) {
  const isLastTask = taskNumber === totalTasks;
  const progressPercent = Math.round((taskNumber / totalTasks) * 100);

  return (
    <div className="target-panel">
      <div className="target-panel-header">
        <div className="target-header-top">
          <span className="target-task-counter">Task {taskNumber} of {totalTasks}</span>
        </div>
        <h2 className="target-panel-heading">Find this photo</h2>
        <p className="target-panel-hint">
          Study the image, then use the phone on the right to search for it.
        </p>
      </div>

      <Progress.Root
        className="target-progress"
        value={taskNumber}
        max={totalTasks}
        getValueLabel={(value, max) => `Task ${value} of ${max}`}
      >
        <Progress.Indicator
          className="target-progress-bar"
          style={{ width: `${progressPercent}%` }}
        />
      </Progress.Root>

      <div className="target-photo-frame" aria-label="Target media">
        <TargetMedia key={item.id} item={item} />
      </div>

      <div className="target-panel-footer">
        <button className="btn-primary" onClick={onNext}>
          {isLastTask ? "Finish Session →" : "Next Task →"}
        </button>
      </div>
    </div>
  );
}
