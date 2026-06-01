import React, { useCallback, useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecallMediaItem } from "@/shared/types/recall";
import { resolvedMediaUrl, resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import { itemTitle, playbackTimeLabel, VIDEO_CHROME_HIDE_MS } from "./phoneUtils";
import { DetailActionRow, DetailScreen, type DetailNeighborPreview } from "./DetailViewChrome";

interface VideoDetailViewProps {
  item: RecallMediaItem;
  canNavigateNext?: boolean;
  canNavigatePrevious?: boolean;
  isSensitiveHidden?: boolean;
  onRevealSensitive?: (item: RecallMediaItem) => void;
  onBack: () => void;
  onNavigate?: (direction: 1 | -1) => void;
  onSearchSameDate: (item: RecallMediaItem) => void;
  onRunSimilarSearch: (item: RecallMediaItem) => void;
  onConfirmAnswer?: (id: string) => void;
  onSendSelection: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  layoutId?: string;
  navigationDirection?: -1 | 0 | 1;
  nextPreview?: DetailNeighborPreview | null;
  previousPreview?: DetailNeighborPreview | null;
}

export function VideoDetailView({
  item,
  canNavigateNext = false,
  canNavigatePrevious = false,
  isSensitiveHidden = false,
  onRevealSensitive,
  onBack,
  onNavigate,
  onSearchSameDate,
  onRunSimilarSearch,
  onConfirmAnswer,
  onSendSelection,
  onToggleFavorite,
  onToggleSafety,
  onOpenAbout,
  layoutId,
  navigationDirection = 0,
  nextPreview = null,
  previousPreview = null,
}: VideoDetailViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoUnmutedRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.metadata.asset?.duration_seconds ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const mediaUrl = resolvedMediaUrl(item);
  const posterUrl = resolvedThumbnailUrl(item) ?? undefined;

  const clearChromeTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearChromeTimer();
    if (!isPlaying || isScrubbing) return;
    hideTimerRef.current = setTimeout(() => {
      setChromeVisible(false);
      hideTimerRef.current = null;
    }, VIDEO_CHROME_HIDE_MS);
  }, [clearChromeTimer, isPlaying, isScrubbing]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(item.metadata.asset?.duration_seconds ?? 0);
    setIsPlaying(false);
    setIsScrubbing(false);
    setChromeVisible(true);
    setIsMuted(true);
    hasAutoUnmutedRef.current = false;
    if (videoRef.current) videoRef.current.muted = true;
    clearChromeTimer();
  }, [clearChromeTimer, item.id, item.metadata.asset?.duration_seconds]);

  useEffect(() => {
    scheduleChromeHide();
    return clearChromeTimer;
  }, [clearChromeTimer, scheduleChromeHide]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setChromeVisible(true);
    if (video.paused) {
      if (!hasAutoUnmutedRef.current) {
        hasAutoUnmutedRef.current = true;
        video.muted = false;
        setIsMuted(false);
      }
      void video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setIsMuted(next);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration)) {
      setDuration(video.duration);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || isScrubbing) return;
    setCurrentTime(video.currentTime);
  }, [isScrubbing]);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    if (!Number.isFinite(nextTime)) return;
    setCurrentTime(nextTime);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
  }, []);

  const startScrubbing = useCallback(() => {
    clearChromeTimer();
    setIsScrubbing(true);
    setChromeVisible(true);
  }, [clearChromeTimer]);

  const stopScrubbing = useCallback(() => {
    setIsScrubbing(false);
  }, []);

  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => !visible);
  }, []);

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const timelineMax = Math.max(duration, 0.01);

  if (!mediaUrl) {
    return null;
  }

  return (
    <DetailScreen
      className={`detail-screen--video ${chromeVisible ? "detail-screen--chrome-visible" : "detail-screen--chrome-hidden"}${isScrubbing ? " detail-screen--scrubbing" : ""}`}
      mediaClassName="detail-media-fill--video"
      topBarClassName="video-chrome"
      item={item}
      canNavigateNext={canNavigateNext}
      canNavigatePrevious={canNavigatePrevious}
      isSensitiveHidden={isSensitiveHidden}
      onRevealSensitive={onRevealSensitive}
      onBack={onBack}
      onNavigate={onNavigate}
      onOpenAbout={onOpenAbout}
      onToggleFavorite={onToggleFavorite}
      onToggleSafety={onToggleSafety}
      layoutId={layoutId}
      navigationDirection={navigationDirection}
      nextPreview={nextPreview}
      previousPreview={previousPreview}
      controls={
        <div className="video-control-panel video-chrome" role="group" aria-label="Detail actions" onPointerMove={revealChrome}>
          <DetailActionRow
            className="video-action-row"
            confirmLabel="Confirm"
            item={item}
            onSearchSameDate={onSearchSameDate}
            onRunSimilarSearch={onRunSimilarSearch}
            onConfirmAnswer={onConfirmAnswer}
            onSendSelection={onSendSelection}
          />

          <div className="video-timeline">
            <Button
              className="video-play-btn"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={togglePlayback}
              aria-label={isPlaying ? "Pause video" : "Play video"}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <span className="video-time video-time--elapsed">{playbackTimeLabel(currentTime)}</span>
            <input
              className="video-scrubber"
              type="range"
              min="0"
              max={timelineMax}
              step="0.01"
              value={Math.min(currentTime, timelineMax)}
              aria-label="Video timeline"
              aria-valuetext={`${playbackTimeLabel(currentTime)} of ${playbackTimeLabel(duration)}`}
              style={{ "--video-progress": `${progress}%` } as React.CSSProperties}
              onChange={handleSeek}
              onPointerDown={startScrubbing}
              onPointerUp={stopScrubbing}
              onPointerCancel={stopScrubbing}
              onTouchEnd={stopScrubbing}
              onMouseUp={stopScrubbing}
            />
            <span className="video-time video-time--duration">{playbackTimeLabel(duration)}</span>
            <Button
              className="video-mute-btn"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute video" : "Mute video"}
            >
              {isMuted ? <VolumeXIcon /> : <Volume2Icon />}
            </Button>
          </div>
        </div>
      }
    >
      {isSensitiveHidden ? (
        <img src={posterUrl ?? item.links?.thumbnail ?? mediaUrl} alt={itemTitle(item)} onContextMenu={(e) => e.preventDefault()} />
      ) : (
        <video
          ref={videoRef}
          src={mediaUrl}
          poster={posterUrl}
          muted
          playsInline
          preload="metadata"
          onClick={toggleChrome}
          onContextMenu={(e) => e.preventDefault()}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => { setIsPlaying(false); setChromeVisible(true); }}
          onEnded={() => { setIsPlaying(false); setChromeVisible(true); }}
        />
      )}
    </DetailScreen>
  );
}
