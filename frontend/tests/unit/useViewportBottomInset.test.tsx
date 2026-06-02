import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewportBottomInset } from "@/features/phone/components/useViewportBottomInset";

const VISUAL_VIEWPORT_BOTTOM_VAR = "--recall-visual-viewport-bottom-inset";
const IOS_WEBVIEW_FALLBACK_VAR = "--recall-ios-webview-bottom-fallback";
const ORIGINAL_NAVIGATOR = {
  userAgent: window.navigator.userAgent,
  platform: window.navigator.platform,
  maxTouchPoints: window.navigator.maxTouchPoints,
  standalone: (window.navigator as Navigator & { standalone?: boolean }).standalone,
};

function Probe() {
  useViewportBottomInset();
  return null;
}

function installVisualViewport({ height, offsetTop = 0 }: { height: number; offsetTop?: number }) {
  const visualViewport = {
    height,
    offsetTop,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 812,
  });

  return visualViewport;
}

function setNavigatorValue(property: string, value: unknown) {
  Object.defineProperty(window.navigator, property, {
    configurable: true,
    value,
  });
}

function installNavigator(values: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  setNavigatorValue("userAgent", values.userAgent);
  setNavigatorValue("platform", values.platform ?? "");
  setNavigatorValue("maxTouchPoints", values.maxTouchPoints ?? 0);
  setNavigatorValue("standalone", values.standalone);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  installNavigator(ORIGINAL_NAVIGATOR);
  document.documentElement.style.removeProperty(VISUAL_VIEWPORT_BOTTOM_VAR);
  document.documentElement.style.removeProperty(IOS_WEBVIEW_FALLBACK_VAR);
});

describe("useViewportBottomInset", () => {
  it("writes measured visual viewport bottom occlusion to CSS variables", () => {
    installVisualViewport({ height: 740 });

    const { unmount } = render(<Probe />);

    expect(document.documentElement.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_VAR)).toBe("72px");
    expect(document.documentElement.style.getPropertyValue(IOS_WEBVIEW_FALLBACK_VAR)).toBe("0px");

    unmount();
    expect(document.documentElement.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_VAR)).toBe("");
    expect(document.documentElement.style.getPropertyValue(IOS_WEBVIEW_FALLBACK_VAR)).toBe("");
  });

  it("uses the manual bottom occlusion override as the fallback variable", () => {
    installVisualViewport({ height: 812 });
    window.localStorage.setItem("recall.bottomOcclusionPx", "88");

    render(<Probe />);

    expect(document.documentElement.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_VAR)).toBe("0px");
    expect(document.documentElement.style.getPropertyValue(IOS_WEBVIEW_FALLBACK_VAR)).toBe("88px");
  });

  it("adds a bottom chrome fallback for iPhone browsers when Safari reports no visual inset", () => {
    installVisualViewport({ height: 812 });
    installNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    });

    render(<Probe />);

    expect(document.documentElement.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_VAR)).toBe("0px");
    expect(document.documentElement.style.getPropertyValue(IOS_WEBVIEW_FALLBACK_VAR)).toBe("84px");
  });

  it("does not add the iPhone browser fallback on Android", () => {
    installVisualViewport({ height: 812 });
    installNavigator({
      userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    });

    render(<Probe />);

    expect(document.documentElement.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_VAR)).toBe("0px");
    expect(document.documentElement.style.getPropertyValue(IOS_WEBVIEW_FALLBACK_VAR)).toBe("0px");
  });
});
