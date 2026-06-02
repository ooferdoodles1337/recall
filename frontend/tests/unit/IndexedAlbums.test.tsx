import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { IndexedAlbumsSheet } from "@/features/phone/components/sheets/IndexedAlbumsSheet";
import { SettingsSheet } from "@/features/phone/components/settings/SettingsSheet";
import {
  DEFAULT_INDEXED_ALBUM_IDS,
  MOCK_ALBUMS,
  readIndexedAlbums,
  writeIndexedAlbums,
} from "@/features/phone/phoneUtils";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("indexed album persistence", () => {
  it("returns the default selection when nothing is stored", () => {
    expect(readIndexedAlbums()).toEqual([...DEFAULT_INDEXED_ALBUM_IDS]);
  });

  it("round-trips a saved selection and drops unknown ids", () => {
    writeIndexedAlbums(["camera", "not-a-real-album", "videos"]);
    expect(readIndexedAlbums()).toEqual(["camera", "videos"]);
  });
});

describe("SettingsSheet", () => {
  function renderSettings(props: Partial<React.ComponentProps<typeof SettingsSheet>> = {}) {
    return render(
      <SettingsSheet
        onClose={vi.fn()}
        indexedAlbumCount={6}
        indexedAlbumTotal={8}
        gridColumns={3}
        onOpenIndexedAlbums={vi.fn()}
        {...props}
      />,
    );
  }

  it("shows the indexed album count and opens the picker from its row", () => {
    const onOpenIndexedAlbums = vi.fn();
    renderSettings({ onOpenIndexedAlbums });

    expect(screen.getByText("6 of 8")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /indexed albums/i }));
    expect(onOpenIndexedAlbums).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while a child sheet owns Escape handling", () => {
    const onClose = vi.fn();
    renderSettings({ onClose, escapeDisabled: true });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("IndexedAlbumsSheet", () => {
  function saveButton() {
    return screen.getByRole("button", { name: /^save(?:\s|\(|$)/i });
  }

  it("renders every mock album", () => {
    render(<IndexedAlbumsSheet initialSelectedIds={[]} onCancel={vi.fn()} onSave={vi.fn()} />);
    for (const album of MOCK_ALBUMS) {
      expect(screen.getByRole("button", { name: new RegExp(album.name, "i") })).toBeInTheDocument();
    }
  });

  it("reflects initial selection via aria-pressed", () => {
    render(<IndexedAlbumsSheet initialSelectedIds={["camera"]} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /camera/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /videos/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles an album and saves the new selection", () => {
    const onSave = vi.fn();
    render(<IndexedAlbumsSheet initialSelectedIds={["camera"]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /videos/i }));
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledWith(["camera", "videos"]);
  });

  it("keeps Save disabled until the draft changes", () => {
    render(<IndexedAlbumsSheet initialSelectedIds={["camera"]} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /videos/i }));
    expect(saveButton()).toBeEnabled();
  });

  it("discards the draft when cancelled", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(<IndexedAlbumsSheet initialSelectedIds={["camera"]} onCancel={onCancel} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /videos/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
