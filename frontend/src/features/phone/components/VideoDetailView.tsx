import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  StarIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecallMediaItem } from "@/shared/types/recall";
import { resolvedMediaUrl, resolvedThumbnailUrl } from "@/shared/media/mediaItem";
import { itemTitle, itemDateLabel, playbackTimeLabel, PHONE_MOTION, MOTION_EASE, VIDEO_CHROME_HIDE_MS } from "./phoneUtils";

interface VideoDetailViewProps {
  item: RecallMediaItem;
  onBack: () => void;
  onSearchSameDate: (item: RecallMediaItem) => void;
  onRunSimilarSearch: (item: RecallMediaItem) => void;
  onConfirmAnswer?: (id: string) => void;
  onSendSelection: (item: RecallMediaItem) => void;
  onToggleFavorite: (item: RecallMediaItem) => void;
  onToggleSafety: (item: RecallMediaItem, state: "safe" | "nsfw") => void;
  onOpenAbout: (item: RecallMediaItem) => void;
  layoutId?: string;
}

const detailBackdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: MOTION_EASE.standard } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: MOTION_EASE.exit } },
};

export function VideoDetailView({
  item,
  onBack,
  onSearchSameDate,
  onRunSimilarSearch,
  onConfirmAnswer,
  onSendSelection,
  onToggleFavorite,
  onToggleSafety,
  onOpenAbout,
  layoutId,
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
    <motion.div
      className={`detail-screen detail-screen--video phone-detail-motion ${chromeVisible ? "detail-screen--chrome-visible" : "detail-screen--chrome-hidden"}${isScrubbing ? " detail-screen--scrubbing" : ""}`}
      aria-label={`${itemTitle(item)} detail view`}
      variants={detailBackdropMotion}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="detail-media-fill detail-media-fill--video phone-detail-media-motion"
        layoutId={layoutId}
        transition={{ duration: PHONE_MOTION.detailMs / 1000, ease: MOTION_EASE.gentle }}
      >
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
      </motion.div>

      <div className="detail-float-top video-chrome">
        <Button
          className="detail-float-btn"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeftIcon />
        </Button>
        {itemDateLabel(item) ? (
          <Badge variant="outline" className="detail-float-info">
            <span>{itemDateLabel(item)}</span>
          </Badge>
        ) : <div className="detail-float-info-spacer" />}
        <Button
          className="detail-float-btn"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onToggleFavorite(item)}
          aria-label={item.metadata.organization?.favorite ? "Remove from favorites" : "Add to favorites"}
        >
          {item.metadata.organization?.favorite ? (
            <StarIcon fill="currentColor" />
          ) : (
            <StarIcon />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="detail-float-btn"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {item.metadata.safety?.state === "nsfw" ? (
              <DropdownMenuItem onClick={() => onToggleSafety(item, "safe")}>
                <ShieldCheckIcon />
                Mark as Safe
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onToggleSafety(item, "nsfw")}>
                <ShieldAlertIcon />
                Mark as NSFW
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpenAbout(item)}>
              <InfoIcon />
              About
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="video-control-panel video-chrome" role="group" aria-label="Detail actions" onPointerMove={revealChrome}>
        <div className="video-action-row">
          <Button
            className="detail-float-action h-auto"
            type="button"
            variant="ghost"
            onClick={() => onSearchSameDate(item)}
          >
            <CalendarIcon data-icon="inline-start" />
            <span>Same Date</span>
          </Button>
          <Button
            className="detail-float-action h-auto"
            type="button"
            variant="ghost"
            onClick={() => onRunSimilarSearch(item)}
          >
            <SearchIcon data-icon="inline-start" />
            <span>Similar</span>
          </Button>
          {onConfirmAnswer ? (
            <Button
              className="detail-float-action detail-float-action--primary h-auto"
              type="button"
              onClick={() => onConfirmAnswer(item.id)}
            >
              <CheckIcon data-icon="inline-start" />
              <span>Confirm</span>
            </Button>
          ) : (
            <Button
              className="detail-float-action detail-float-action--primary h-auto"
              type="button"
              onClick={() => onSendSelection(item)}
            >
              <SendIcon data-icon="inline-start" />
              <span>Send</span>
            </Button>
          )}
        </div>

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
    </motion.div>
  );
}