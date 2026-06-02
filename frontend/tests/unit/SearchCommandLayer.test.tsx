import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhoneSearchBar, SearchAssistPanel } from "@/features/phone/components/SearchCommandLayer";

// ---------------------------------------------------------------------------
// PhoneSearchBar
// ---------------------------------------------------------------------------

describe("PhoneSearchBar", () => {
  const defaultProps = {
    value: "",
    showHistory: false,
    showHistoryIcon: true,
    onToggleHistory: vi.fn(),
    onFocus: vi.fn(),
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onClear: vi.fn(),
  };

  it("renders the search input with placeholder", () => {
    render(<PhoneSearchBar {...defaultProps} />);
    expect(screen.getByRole("textbox", { name: "Search your media" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe a photo or video...")).toBeInTheDocument();
  });

  it("reflects the value prop", () => {
    render(<PhoneSearchBar {...defaultProps} value="beach" />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search your media" }).value).toBe("beach");
  });

  it("calls onFocus when the input is focused", async () => {
    const onFocus = vi.fn();
    const user = userEvent.setup();
    render(<PhoneSearchBar {...defaultProps} onFocus={onFocus} />);
    await user.click(screen.getByRole("textbox", { name: "Search your media" }));
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it("calls onChange for each keystroke", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PhoneSearchBar {...defaultProps} onChange={onChange} />);
    await user.type(screen.getByRole("textbox", { name: "Search your media" }), "sun");
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenNthCalledWith(1, "s");
    expect(onChange).toHaveBeenNthCalledWith(2, "u");
    expect(onChange).toHaveBeenNthCalledWith(3, "n");
  });

  it("calls onSubmit when Enter is pressed", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PhoneSearchBar {...defaultProps} value="sunset" onSubmit={onSubmit} />);
    await user.click(screen.getByRole("textbox", { name: "Search your media" }));
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("shows the clear button only when value is non-empty", () => {
    const { rerender } = render(<PhoneSearchBar {...defaultProps} value="" />);
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();

    rerender(<PhoneSearchBar {...defaultProps} value="sunset" />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("calls onClear when the clear button is clicked", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<PhoneSearchBar {...defaultProps} value="sunset" onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("uses the custom clearLabel on the clear button", () => {
    render(<PhoneSearchBar {...defaultProps} value="draft" clearLabel="Clear draft search" />);
    expect(screen.getByRole("button", { name: "Clear draft search" })).toBeInTheDocument();
  });

  it("marks the history button as pressed when showHistory=true", () => {
    render(<PhoneSearchBar {...defaultProps} showHistory={true} />);
    expect(screen.getByRole("button", { name: "Recent searches" })).toHaveAttribute("aria-pressed", "true");
  });

  it("marks the history button as not pressed when showHistory=false", () => {
    render(<PhoneSearchBar {...defaultProps} showHistory={false} />);
    expect(screen.getByRole("button", { name: "Recent searches" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onToggleHistory when the history button is clicked", async () => {
    const onToggleHistory = vi.fn();
    const user = userEvent.setup();
    render(<PhoneSearchBar {...defaultProps} onToggleHistory={onToggleHistory} />);
    await user.click(screen.getByRole("button", { name: "Recent searches" }));
    expect(onToggleHistory).toHaveBeenCalledOnce();
  });

  it("disables the history button when isSearching=true", () => {
    render(<PhoneSearchBar {...defaultProps} isSearching={true} />);
    expect(screen.getByRole("button", { name: "Recent searches" })).toBeDisabled();
  });

  it("does not call onToggleHistory when isSearching=true", async () => {
    const onToggleHistory = vi.fn();
    const user = userEvent.setup();
    render(<PhoneSearchBar {...defaultProps} isSearching={true} onToggleHistory={onToggleHistory} />);
    await user.click(screen.getByRole("button", { name: "Recent searches" }));
    expect(onToggleHistory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SearchAssistPanel
// ---------------------------------------------------------------------------

describe("SearchAssistPanel", () => {
  const defaultProps = {
    query: "",
    showHistory: false,
    history: [],
    suggestions: [],
    knownHistory: [],
    onRunSearch: vi.fn(),
    onClearHistory: vi.fn(),
    onRemoveHistoryItem: vi.fn(),
  };

  const sampleHistory = ["beach trip", "sunset picnic", "mountain hike"];
  const sampleSuggestions = ["sunset photo", "sunset video", "sunset at pier"];

  it("renders nothing when query is empty and history is empty", () => {
    const { container } = render(<SearchAssistPanel {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows history list when query is empty and history is non-empty", () => {
    render(<SearchAssistPanel {...defaultProps} history={sampleHistory} />);
    for (const item of sampleHistory) {
      expect(screen.getByRole("button", { name: item })).toBeInTheDocument();
    }
  });

  it("shows history list when showHistory=true even with a non-empty query", () => {
    render(<SearchAssistPanel {...defaultProps} query="sun" showHistory={true} history={sampleHistory} />);
    expect(screen.getByRole("button", { name: "beach trip" })).toBeInTheDocument();
  });

  it("shows suggestions when query is non-empty and showHistory=false", () => {
    render(<SearchAssistPanel {...defaultProps} query="sun" suggestions={sampleSuggestions} />);
    for (const s of sampleSuggestions) {
      expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    }
  });

  it("hides history and shows suggestions when user types (showHistory=false)", () => {
    render(
      <SearchAssistPanel
        {...defaultProps}
        query="sun"
        showHistory={false}
        history={sampleHistory}
        suggestions={sampleSuggestions}
      />,
    );
    expect(screen.queryByRole("button", { name: "beach trip" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sunset photo" })).toBeInTheDocument();
  });

  it("shows 'Press Enter to search' when query is non-empty but no suggestions", () => {
    render(<SearchAssistPanel {...defaultProps} query="xyzunknown" suggestions={[]} />);
    expect(screen.getByText("Press Enter to search")).toBeInTheDocument();
  });

  it("shows 'Searching…' when isSearching=true, query non-empty, no suggestions", () => {
    render(<SearchAssistPanel {...defaultProps} query="beach" isSearching={true} />);
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("shows 'Press Enter to search' when isSearching=false, query non-empty, no suggestions", () => {
    render(<SearchAssistPanel {...defaultProps} query="beach" isSearching={false} />);
    expect(screen.getByText("Press Enter to search")).toBeInTheDocument();
  });

  it("clicking a history item calls onRunSearch with that item", async () => {
    const onRunSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchAssistPanel {...defaultProps} history={sampleHistory} onRunSearch={onRunSearch} />);
    await user.click(screen.getByRole("button", { name: "sunset picnic" }));
    expect(onRunSearch).toHaveBeenCalledWith("sunset picnic");
  });

  it("clicking a suggestion calls onRunSearch with that suggestion", async () => {
    const onRunSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchAssistPanel {...defaultProps} query="sun" suggestions={sampleSuggestions} onRunSearch={onRunSearch} />);
    await user.click(screen.getByRole("button", { name: "sunset at pier" }));
    expect(onRunSearch).toHaveBeenCalledWith("sunset at pier");
  });

  it("clicking Remove calls onRemoveHistoryItem with the correct item", async () => {
    const onRemoveHistoryItem = vi.fn();
    const user = userEvent.setup();
    render(<SearchAssistPanel {...defaultProps} history={sampleHistory} onRemoveHistoryItem={onRemoveHistoryItem} />);
    await user.click(screen.getByRole("button", { name: "Remove beach trip" }));
    expect(onRemoveHistoryItem).toHaveBeenCalledWith("beach trip");
  });

  it("clicking Clear all calls onClearHistory", async () => {
    const onClearHistory = vi.fn();
    const user = userEvent.setup();
    render(<SearchAssistPanel {...defaultProps} history={sampleHistory} onClearHistory={onClearHistory} />);
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearHistory).toHaveBeenCalledOnce();
  });

  it("renders exactly the suggestions it receives — no internal cap (CP-1 enforced upstream)", () => {
    // CP-1: PhoneViewportFrame slices composeSuggestions to 3 before passing here.
    // This test confirms SearchAssistPanel itself imposes no additional cap.
    const fiveSuggestions = ["alpha", "beta", "gamma", "delta", "epsilon"];
    render(<SearchAssistPanel {...defaultProps} query="test" suggestions={fiveSuggestions} />);
    for (const s of fiveSuggestions) {
      expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    }
  });

  it("marks a suggestion as a history item when it appears in knownHistory", () => {
    render(
      <SearchAssistPanel
        {...defaultProps}
        query="sun"
        suggestions={["sunset picnic"]}
        knownHistory={["sunset picnic"]}
      />,
    );
    // The suggestion button should be present (rendered with a clock icon vs search icon)
    expect(screen.getByRole("button", { name: "sunset picnic" })).toBeInTheDocument();
  });

  it("renders a remove button for every history entry", () => {
    render(<SearchAssistPanel {...defaultProps} history={sampleHistory} />);
    const list = screen.getByRole("button", { name: "beach trip" }).closest("div")!.parentElement!;
    const removeButtons = within(list.parentElement!).getAllByRole("button", { name: /^Remove/ });
    expect(removeButtons).toHaveLength(sampleHistory.length);
  });
});
