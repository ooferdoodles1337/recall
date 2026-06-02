import { useEffect } from "react";

const VISUAL_VIEWPORT_BOTTOM_VAR = "--recall-visual-viewport-bottom-inset";
const IOS_WEBVIEW_FALLBACK_VAR = "--recall-ios-webview-bottom-fallback";
const OVERRIDE_QUERY_PARAM = "recallBottomOcclusion";
const OVERRIDE_STORAGE_KEY = "recall.bottomOcclusionPx";
const IOS_26_WEBVIEW_FALLBACK_PX = 72;

function clampInset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(320, Math.round(value)));
}

function readNumericValue(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clampInset(parsed) : null;
}

function readManualOverride(): number | null {
  const fromQuery = readNumericValue(new URLSearchParams(window.location.search).get(OVERRIDE_QUERY_PARAM));
  if (fromQuery !== null) return fromQuery;

  try {
    return readNumericValue(window.localStorage.getItem(OVERRIDE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function isIOSLikeDevice(): boolean {
  const platform = navigator.platform;
  const ua = navigator.userAgent;
  return /iP(?:hone|ad|od)/.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function parsedIOSVersion(): { major: number; minor: number } | null {
  const match = navigator.userAgent.match(/(?:iPhone OS|CPU(?: iPhone)? OS|CPU OS)\s+(\d+)[._](\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function shouldApplyIOS26WebViewFallback(measuredBottom: number): boolean {
  if (!isIOSLikeDevice() || measuredBottom >= 24) return false;

  const version = parsedIOSVersion();
  return version?.major === 26 && version.minor === 0;
}

function measureVisualViewportBottomInset(): number {
  const visualViewport = window.visualViewport;
  if (!visualViewport) return 0;

  return clampInset(window.innerHeight - (visualViewport.offsetTop + visualViewport.height));
}

export function useViewportBottomInset() {
  useEffect(() => {
    const root = document.documentElement;
    const visualViewport = window.visualViewport;
    const timeouts: number[] = [];
    let animationFrame = 0;

    const applyInsets = () => {
      const manualOverride = readManualOverride();
      const measuredBottom = measureVisualViewportBottomInset();
      const fallback = manualOverride ?? (shouldApplyIOS26WebViewFallback(measuredBottom) ? IOS_26_WEBVIEW_FALLBACK_PX : 0);

      root.style.setProperty(VISUAL_VIEWPORT_BOTTOM_VAR, `${measuredBottom}px`);
      root.style.setProperty(IOS_WEBVIEW_FALLBACK_VAR, `${fallback}px`);
    };

    const scheduleApplyInsets = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(applyInsets);
    };

    applyInsets();
    timeouts.push(window.setTimeout(applyInsets, 250));
    timeouts.push(window.setTimeout(applyInsets, 1000));

    visualViewport?.addEventListener("resize", scheduleApplyInsets);
    visualViewport?.addEventListener("scroll", scheduleApplyInsets);
    window.addEventListener("resize", scheduleApplyInsets);
    window.addEventListener("orientationchange", scheduleApplyInsets);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      for (const timeout of timeouts) window.clearTimeout(timeout);
      visualViewport?.removeEventListener("resize", scheduleApplyInsets);
      visualViewport?.removeEventListener("scroll", scheduleApplyInsets);
      window.removeEventListener("resize", scheduleApplyInsets);
      window.removeEventListener("orientationchange", scheduleApplyInsets);
      root.style.removeProperty(VISUAL_VIEWPORT_BOTTOM_VAR);
      root.style.removeProperty(IOS_WEBVIEW_FALLBACK_VAR);
    };
  }, []);
}
