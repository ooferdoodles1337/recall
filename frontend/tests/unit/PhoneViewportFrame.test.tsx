import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhoneViewportFrame } from "@/features/phone/components/PhoneViewportFrame";
import { phoneMockState } from "../msw/handlers";

const SEARCH_HISTORY_KEY = "recall.searchHistory.v1";
const GRID_COLUMNS_STORAGE_KEY = "recall.phoneGridColumns.v1";

function renderPhone(props: React.ComponentProps<typeof PhoneViewportFrame> = {}) {
  return render(<PhoneViewportFrame {...props} />);
}

function currentSearchInput() {
  const inputs = screen.getAllByLabelText("Search your media");
  return inputs[inputs.length - 1] as HTMLInputElement;
}

async function waitForPhoneHome() {
  await screen.findByRole("button", { name: /Select Favorite 01/i });
}

async function commitSearch(query: string, user = userEvent.setup()) {
  await waitForPhoneHome();
  await user.click(currentSearchInput());
  await user.type(currentSearchInput(), query);
  await user.keyboard("{Enter}");
}

async function openDetailFromButton(button: HTMLElement) {
  vi.useFakeTimers();
  fireEvent.pointerDown(button, {
    clientX: 24,
    clientY: 24,
    pointerId: 1,
    pointerType: "mouse",
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(550);
  });
  vi.useRealTimers();
}

function dispatchSyntheticPointer(
  target: Element,
  type: string,
  props: Record<string, string | number | boolean>,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(target, event);
}

describe("PhoneViewportFrame interactions", () => {
  it("shows suggestions, commits a search, and merges semantic and text results without duplicates", async () => {
    const user = userEvent.setup();
    renderPhone();

    await waitForPhoneHome();
    await user.click(currentSearchInput());
    await user.type(currentSearchInput(), "sunset");

    expect((await screen.findAllByRole("button", { name: /sunset picnic/i })).length).toBeGreaterThan(0);

    await user.keyboard("{Enter}");

    expect(await screen.findByRole("button", { name: /Select Sunset pier photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select Text-only mountain cabin/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Shared picnic blanket/i })).toHaveLength(1);
    expect(phoneMockState.requests.some((request) => request.includes("/search/semantic?q=sunset"))).toBe(true);
    expect(phoneMockState.requests.some((request) => request.includes("/search/text?q=sunset"))).toBe(true);
  });

  it("runs autosearch in the background without dismissing compose or saving history", async () => {
    const user = userEvent.setup();
    renderPhone();

    await waitForPhoneHome();
    await user.click(currentSearchInput());
    await user.type(currentSearchInput(), "su");

    await waitFor(() => {
      expect(phoneMockState.requests.some((request) => request.includes("/search/semantic?q=su"))).toBe(true);
    });

    expect(await screen.findByRole("button", { name: /Select Sunset pier photo/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /sunset picnic/i }).length).toBeGreaterThan(0);
      expect(currentSearchInput()).toHaveValue("su");
      expect(document.activeElement).toBe(currentSearchInput());
    });
    expect(JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]")).toEqual([]);
  });

  it("renders empty results and backend fallback states", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPhone();

    await commitSearch("empty beach", user);
    expect(await screen.findByText("No results")).toBeInTheDocument();

    unmount();
    phoneMockState.failSemantic = true;
    phoneMockState.failText = true;
    renderPhone();

    await commitSearch("offline archive", user);
    expect(
      await screen.findByText("Backend unavailable. Showing sample tiles until the media bundle is indexed."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Select offline archive/i }).length).toBeGreaterThan(0);
  });

  it("saves, removes, clears, and exits search history through visible controls", async () => {
    const user = userEvent.setup();
    const view = renderPhone();

    await commitSearch("sunset picnic", user);
    expect(await screen.findByRole("button", { name: /Select Sunset pier photo/i })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]")).toContain("sunset picnic");

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByRole("heading", { name: "Recall" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recent searches" }));
    expect(screen.getByRole("button", { name: "sunset picnic" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove sunset picnic" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "sunset picnic" })).not.toBeInTheDocument();
    });

    view.unmount();
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(["mountain", "coffee"]));
    renderPhone();
    await waitForPhoneHome();
    await user.click(screen.getByRole("button", { name: "Recent searches" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]")).toEqual([]);
  });

  it("selects, removes, sends, and confirms items from the selection tray", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPhone();

    await user.click(await screen.findByRole("button", { name: /Select Favorite 01/i }));
    const tray = await screen.findByRole("region", { name: "Selection tray" });
    expect(tray).toHaveTextContent("1 selected");

    await user.click(screen.getByRole("button", { name: /Remove Favorite 01 from selection/i }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Selection tray" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Select Favorite 02/i }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Selection tray" })).not.toBeInTheDocument();
    });

    unmount();
    const onConfirmAnswer = vi.fn();
    renderPhone({ onConfirmAnswer });

    await user.click(await screen.findByRole("button", { name: /Select Favorite 01/i }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(onConfirmAnswer).toHaveBeenCalledWith("favorite-01");
  });

  it("opens detail on long press, goes back, searches same date, and runs similar search", async () => {
    const user = userEvent.setup();
    const onSelectCandidate = vi.fn();
    const firstView = renderPhone({ onSelectCandidate });

    await openDetailFromButton(await screen.findByRole("button", { name: /Select Favorite 01/i }));
    expect(await screen.findByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(onSelectCandidate).toHaveBeenCalledWith("favorite-01");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Recall" })).toBeInTheDocument();
    firstView.unmount();

    const secondView = renderPhone();
    await openDetailFromButton(await screen.findByRole("button", { name: /Select Favorite 01/i }));
    await user.click(screen.getByRole("button", { name: /Same Date/i }));
    expect((await screen.findAllByRole("button", { name: /Select Dated picnic photo/i })).length).toBeGreaterThan(0);
    expect(phoneMockState.requests.some((request) => request.includes("q=2024-03-18"))).toBe(true);
    secondView.unmount();

    renderPhone();
    await openDetailFromButton(await screen.findByRole("button", { name: /Select Dated picnic photo/i }));
    await user.click(screen.getByRole("button", { name: /Similar/i }));
    expect(await screen.findByRole("button", { name: /Select Similar yellow umbrella/i })).toBeInTheDocument();
    expect(phoneMockState.requests.some((request) => request.includes("/search/similar/dated-favorite"))).toBe(true);
  });

  it("guards NSFW tiles until revealing one item or all sensitive items", async () => {
    const user = userEvent.setup();
    renderPhone();

    await user.click((await screen.findAllByRole("button", { name: /Sensitive content/i }))[0]);
    const oneDialog = await screen.findByRole("dialog", { name: "Sensitive content warning" });
    await user.click(within(oneDialog).getByRole("button", { name: "Reveal This One" }));
    expect(await screen.findByRole("button", { name: /Select Sensitive favorite/i })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Sensitive content/i })[0]);
    const allDialog = await screen.findByRole("dialog", { name: "Sensitive content warning" });
    await user.click(within(allDialog).getByRole("button", { name: "Reveal for Session" }));

    expect(await screen.findByRole("button", { name: /Select Second sensitive favorite/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select Sensitive favorite/i })).toBeInTheDocument();
  });

  it("shows video detail playback controls without breaking Back, Similar, or Send", async () => {
    const user = userEvent.setup();
    renderPhone();

    await openDetailFromButton(await screen.findByRole("button", { name: /Select Favorite video clip/i }));

    expect(await screen.findByRole("button", { name: "Play video" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Video timeline" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play video" }));
    expect(await screen.findByRole("button", { name: "Pause video" })).toBeInTheDocument();

    // Confirm (send) resets to home — no selection tray, home heading visible
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { name: "Recall" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selection tray" })).not.toBeInTheDocument();

    await openDetailFromButton(await screen.findByRole("button", { name: /Select Favorite video clip/i }));
    await user.click(screen.getByRole("button", { name: /Similar/i }));
    expect(await screen.findByRole("button", { name: /Select Similar yellow umbrella/i })).toBeInTheDocument();
  });

  it("collapses compose panel on scroll down over results, re-expands on scroll up (SR-1)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await commitSearch("sunset", user);
    await screen.findByRole("button", { name: /Select Sunset pier photo/i });

    await user.click(currentSearchInput());
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
    });
    expect(document.querySelector(".phone-compose-section")).toBeInTheDocument();

    const viewport = document.querySelector(".phone-rect-viewport") as HTMLElement;
    const scrollTopSpy = vi.spyOn(viewport, "scrollTop", "get").mockReturnValue(80);
    fireEvent.scroll(viewport);

    await waitFor(() => {
      expect(document.querySelector(".phone-compose-section")).not.toBeInTheDocument();
    });
    expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
    expect(document.activeElement).toBe(currentSearchInput());

    scrollTopSpy.mockReturnValue(0);
    fireEvent.scroll(viewport);

    await waitFor(() => {
      expect(document.querySelector(".phone-compose-section")).toBeInTheDocument();
    });
    scrollTopSpy.mockRestore();
  });

  it("re-expands compose panel on keystroke after scroll collapse (SR-1)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await commitSearch("sunset", user);
    await screen.findByRole("button", { name: /Select Sunset pier photo/i });

    await user.click(currentSearchInput());
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
    });

    const viewport = document.querySelector(".phone-rect-viewport") as HTMLElement;
    const scrollTopSpy = vi.spyOn(viewport, "scrollTop", "get").mockReturnValue(80);
    fireEvent.scroll(viewport);
    await waitFor(() => {
      expect(document.querySelector(".phone-compose-section")).not.toBeInTheDocument();
    });

    await user.type(currentSearchInput(), "x");
    await waitFor(() => {
      expect(document.querySelector(".phone-compose-section")).toBeInTheDocument();
    });
    scrollTopSpy.mockRestore();
  });

  it("dismisses compose entirely on scroll down over home feed (SR-1 home)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await waitForPhoneHome();
    await user.click(currentSearchInput());
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
    });

    const viewport = document.querySelector(".phone-rect-viewport") as HTMLElement;
    const scrollTopSpy = vi.spyOn(viewport, "scrollTop", "get").mockReturnValue(80);
    fireEvent.scroll(viewport);
    scrollTopSpy.mockRestore();

    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).not.toBeInTheDocument();
    });
    expect(currentSearchInput()).toBeInTheDocument();
  });

  it("does not hide the search bar element when scrolling in results mode (SR-2)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await commitSearch("sunset", user);
    await screen.findByRole("button", { name: /Select Sunset pier photo/i });

    const viewport = document.querySelector(".phone-rect-viewport");
    if (viewport instanceof HTMLElement) {
      const scrollTopSpy = vi.spyOn(viewport, "scrollTop", "get").mockReturnValue(400);
      fireEvent.scroll(viewport);
      scrollTopSpy.mockRestore();
    }

    // Bar is always present regardless of scroll position
    expect(screen.getByLabelText("Search your media")).toBeInTheDocument();
  });

  it("applies search-panel--expanded and collapses it on dismiss (CP-2 structure)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await commitSearch("sunset", user);
    await screen.findByRole("button", { name: /Select Sunset pier photo/i });

    // In results mode — no expanded panel
    expect(document.querySelector(".search-panel--expanded")).not.toBeInTheDocument();

    // Click bar — enters compose mode — panel expands
    await user.click(currentSearchInput());
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
    });

    // Press Escape or clear to dismiss compose
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).not.toBeInTheDocument();
    });
  });

  it("persists grid density from zoom controls and touch pinch gestures", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPhone();

    await waitForPhoneHome();
    const phone = screen.getByLabelText("Phone interface viewport");
    expect(phone).toHaveStyle({ "--phone-grid-columns": "3" });

    const zoomOut = screen.getByRole("button", { name: "Zoom out to show more thumbnails" });
    await user.click(zoomOut);
    await user.click(zoomOut);
    await user.click(zoomOut);
    await user.click(zoomOut);

    expect(phone).toHaveStyle({ "--phone-grid-columns": "6" });
    expect(window.localStorage.getItem(GRID_COLUMNS_STORAGE_KEY)).toBe("6");

    const gestureZone = screen.getByTestId("phone-favorites-grid-zone");
    dispatchSyntheticPointer(gestureZone, "pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 0,
      clientY: 0,
    });
    dispatchSyntheticPointer(gestureZone, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 100,
      clientY: 0,
    });
    dispatchSyntheticPointer(gestureZone, "pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 300,
      clientY: 0,
    });

    expect(phone).toHaveStyle({ "--phone-grid-columns": "2" });
    expect(window.localStorage.getItem(GRID_COLUMNS_STORAGE_KEY)).toBe("2");

    unmount();
    renderPhone();
    expect(await screen.findByLabelText("Phone interface viewport")).toHaveStyle({
      "--phone-grid-columns": "2",
    });
  });

  it("shows at most 3 suggestions in compose mode (CP-1)", async () => {
    const user = userEvent.setup();
    renderPhone();
    await waitForPhoneHome();
    await user.click(currentSearchInput());
    await user.type(currentSearchInput(), "sunset");

    // Compose panel should be visible
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
    });

    // Count suggestion buttons inside the compose section
    const composeSection = document.querySelector(".phone-compose-section");
    expect(composeSection).toBeInTheDocument();
    const suggestionBtns = composeSection?.querySelectorAll("button") ?? [];
    expect(suggestionBtns.length).toBeLessThanOrEqual(3);
  });

  it("returns to home when search field is emptied over results (SC-1)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await commitSearch("sunset", user);
    expect(await screen.findByRole("button", { name: /Select Sunset pier photo/i })).toBeInTheDocument();

    await user.click(currentSearchInput());
    await user.clear(currentSearchInput());

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Select Sunset pier photo/i })).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("heading", { name: "Recall" })).toBeInTheDocument();
  });

  it("restores previous query text on compose dismiss (FC-2 query preservation)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await waitForPhoneHome();
    await user.click(currentSearchInput());
    await user.type(currentSearchInput(), "beach day");
    await user.keyboard("{Escape}");

    // Query should revert to the pre-compose value (empty string, since no previous commit)
    await waitFor(() => {
      expect(currentSearchInput()).toHaveValue("");
    });
  });

  it("cancels in-flight search and clears results on empty query over results (SC-1 abort)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await commitSearch("sunset", user);
    await screen.findByRole("button", { name: /Select Sunset pier photo/i });

    // Type something, then backspace to empty
    await user.click(currentSearchInput());
    await user.type(currentSearchInput(), "x");
    await user.clear(currentSearchInput());

    // Should return home
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Recall" })).toBeInTheDocument();
    });
  });

  it("does not return home when query emptied over home screen (SC-1 scope)", async () => {
    const user = userEvent.setup();
    renderPhone();

    await waitForPhoneHome();
    await user.click(currentSearchInput());
    await user.type(currentSearchInput(), "x");
    await user.clear(currentSearchInput());

    // Still on home — compose may dismiss but heading stays
    expect(screen.getByRole("heading", { name: "Recall" })).toBeInTheDocument();
  });

  it("renders a single persistent search bar above the scroll area in all modes (architectural)", async () => {
    const user = userEvent.setup();
    renderPhone();

    // In home mode, the search bar should live in .phone-persistent-section outside scroll area
    await waitForPhoneHome();
    const persistentSections = document.querySelectorAll(".phone-persistent-section");
    expect(persistentSections.length).toBe(1);
    expect(document.querySelector(".phone-startpage-search-sticky")).not.toBeInTheDocument();

    // Enter compose mode — still a single persistent section, no sticky variant
    await user.click(currentSearchInput());
    await waitFor(() => {
      expect(document.querySelector(".search-panel--expanded")).toBeInTheDocument();
    });
    expect(document.querySelectorAll(".phone-persistent-section").length).toBe(1);
    expect(document.querySelector(".phone-startpage-search-sticky")).not.toBeInTheDocument();

    // Commit search to reach results mode
    await user.type(currentSearchInput(), "sunset");
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: /Select Sunset pier photo/i });

    // In results mode — still a single persistent section
    expect(document.querySelectorAll(".phone-persistent-section").length).toBe(1);
    expect(document.querySelector(".phone-startpage-search-sticky")).not.toBeInTheDocument();

    // The search bar must be above the scroll area, not inside it
    const viewport = document.querySelector(".phone-rect-viewport");
    expect(document.querySelector(".phone-persistent-section")).toBeInTheDocument();
    expect(viewport?.contains(document.querySelector(".phone-persistent-section"))).toBe(false);
  });
});
