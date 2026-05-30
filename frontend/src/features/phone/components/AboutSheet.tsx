import { AnimatePresence, motion } from "motion/react";
import {
  CalendarIcon,
  CameraIcon,
  FileIcon,
  ImageIcon,
  MapPinIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  VideoIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RecallMediaItem } from "@/shared/types/recall";

interface AboutSheetProps {
  item: RecallMediaItem | null;
  onClose: () => void;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function dimensionsLabel(item: RecallMediaItem): string | null {
  const { width, height } = item.metadata.asset ?? {};
  if (typeof width === "number" && typeof height === "number") {
    return `${width} × ${height}`;
  }
  return null;
}

function durationLabel(seconds?: number): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function locationLabel(item: RecallMediaItem): string | null {
  const loc = item.metadata.capture?.location;
  if (!loc) return null;
  const parts: string[] = [];
  if (loc.city) parts.push(loc.city);
  if (loc.state) parts.push(loc.state);
  if (loc.country) parts.push(loc.country);
  return parts.length > 0 ? parts.join(", ") : null;
}

function mimeLabel(mime?: string): string {
  if (!mime) return "Unknown";
  if (mime.startsWith("image/")) return "Photo";
  if (mime.startsWith("video/")) return "Video";
  return mime;
}

export function AboutSheet({ item, onClose }: AboutSheetProps) {
  if (!item) return null;

  const safety = item.metadata.safety;
  const safetyState = safety?.state ?? "unknown";
  const isSafe = safetyState === "safe";
  const isNsfw = safetyState === "nsfw";

  const search = item.metadata.search;
  const description = search?.description;

  const capture = item.metadata.capture;
  const date = capture?.taken_at ?? capture?.date;
  const loc = locationLabel(item);

  const asset = item.metadata.asset;
  const dims = dimensionsLabel(item);
  const dur = durationLabel(asset?.duration_seconds);
  const filename = asset?.filename;
  const mime = asset?.mime_type;

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          className="about-backdrop"
          role="dialog"
          aria-modal
          aria-label="About this media"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="about-sheet"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="about-sheet-header" onClick={onClose}>
              <div className="about-sheet-handle" aria-hidden />
              <button className="about-sheet-done" type="button" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                Done
              </button>
            </div>

            <div className="about-sheet-scroll">
              {description ? (
                <section className="about-section">
                  <p className="about-desc">{description}</p>
                </section>
              ) : null}

              <section className="about-section">
                <h3 className="about-section-title">When & Where</h3>
                <div className="about-field-list">
                  {date ? (
                    <div className="about-field">
                      <CalendarIcon className="about-field-icon" />
                      <span>{formatDate(date)}</span>
                    </div>
                  ) : null}
                  {loc ? (
                    <div className="about-field">
                      <MapPinIcon className="about-field-icon" />
                      <span>{loc}</span>
                    </div>
                  ) : null}
                  {!date && !loc ? (
                    <span className="about-empty">No date or location data</span>
                  ) : null}
                </div>
              </section>

              <section className="about-section">
                <h3 className="about-section-title">File Info</h3>
                <div className="about-field-list">
                  <div className="about-field">
                    <CameraIcon className="about-field-icon" />
                    <span>{mimeLabel(mime)}</span>
                  </div>
                  {dims ? (
                    <div className="about-field">
                      <ImageIcon className="about-field-icon" />
                      <span>{dims}</span>
                    </div>
                  ) : null}
                  {dur ? (
                    <div className="about-field">
                      <VideoIcon className="about-field-icon" />
                      <span>{dur}</span>
                    </div>
                  ) : null}
                  {filename ? (
                    <div className="about-field">
                      <FileIcon className="about-field-icon" />
                      <span className="about-filename">{filename}</span>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="about-section">
                <h3 className="about-section-title">Status</h3>
                <div className="about-field-list">
                  <div className="about-field">
                    {isSafe ? (
                      <ShieldCheckIcon className="about-field-icon about-field-icon--safe" />
                    ) : (
                      <ShieldAlertIcon className="about-field-icon about-field-icon--nsfw" />
                    )}
                    <span>
                      {isNsfw ? (
                        <Badge variant="destructive">NSFW</Badge>
                      ) : isSafe ? (
                        <Badge variant="secondary">Safe</Badge>
                      ) : (
                        <Badge variant="outline">Not reviewed</Badge>
                      )}
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}