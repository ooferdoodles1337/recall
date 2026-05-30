import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "../msw/server";
import { phoneHandlers, resetPhoneMockState } from "../msw/handlers";

const originalFetch = globalThis.fetch.bind(globalThis);

beforeAll(() => {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/")) {
      return originalFetch(new URL(input, window.location.origin), init);
    }
    if (input instanceof Request && input.url.startsWith("/")) {
      return originalFetch(new Request(new URL(input.url, window.location.origin), input), init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetPhoneMockState();
  server.resetHandlers(...phoneHandlers());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

afterAll(() => {
  server.close();
  globalThis.fetch = originalFetch;
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: TestResizeObserver,
});

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: TestResizeObserver,
});

if (!window.PointerEvent) {
  Object.defineProperty(window, "PointerEvent", {
    writable: true,
    value: MouseEvent,
  });
}

Object.defineProperty(HTMLElement.prototype, "animate", {
  configurable: true,
  value: vi.fn(() => ({
    cancel: vi.fn(),
    finished: Promise.resolve(),
    play: vi.fn(),
  })),
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(function scrollTo(this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object" && options !== null && typeof options.top === "number") {
      this.scrollTop = options.top;
    } else if (typeof options === "number") {
      this.scrollTop = options;
    }
  }),
});

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(function play(this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }),
});

Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(function pause(this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
    this.dispatchEvent(new Event("pause"));
  }),
});
