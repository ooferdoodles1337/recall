import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewportBottomInset } from "@/features/phone/hooks/useViewportBottomInset";

const VISUAL_VIEWPORT_BOTTOM_VAR = "--recall-visual-viewport-bottom-inset";
const IOS_WEBVIEW_FALLBACK_VAR = "--recall-ios-webview-bottom-fallback";

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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
});
