import { describe, expect, it } from "vitest";
import {
  initialPhoneModeState,
  phoneModeReducer,
  type PhoneBgContent,
  type PhoneModeState,
  type PhoneScreen,
} from "@/features/phone/phoneReducer";

/** Build a minimal state with the given screen and bgContent. */
function stateIn(screen: PhoneScreen, bgContent: PhoneBgContent = screen === "results" ? "results" : "home"): PhoneModeState {
  return {
    ...initialPhoneModeState,
    screen,
    bgContent,
    transition: { ...initialPhoneModeState.transition, from: screen, to: screen },
  };
}

describe("phoneModeReducer — SEARCH_FOCUS", () => {
  it("home → compose with bgContent=home", () => {
    const next = phoneModeReducer(stateIn("home"), { type: "SEARCH_FOCUS", startQuery: "sunset" });
    expect(next.screen).toBe("compose");
    expect(next.bgContent).toBe("home");
    expect(next.composeStartQuery).toBe("sunset");
    expect(next.transition.reason).toBe("search-focus");
    expect(next.transition.direction).toBe("forward");
  });

  it("results → compose with bgContent=results (not home)", () => {
    const next = phoneModeReducer(stateIn("results", "results"), { type: "SEARCH_FOCUS", startQuery: "edit" });
    expect(next.screen).toBe("compose");
    expect(next.bgContent).toBe("results");
  });

  it("saves composeStartQuery for restore on dismiss", () => {
    const next = phoneModeReducer(stateIn("results", "results"), { type: "SEARCH_FOCUS", startQuery: "beach trip" });
    expect(next.composeStartQuery).toBe("beach trip");
  });

  it("from compose is a no-op (regression: bar refocus must not re-enter compose)", () => {
    const state = stateIn("compose", "results");
    expect(phoneModeReducer(state, { type: "SEARCH_FOCUS", startQuery: "" })).toBe(state);
  });

  it("from detail is a no-op", () => {
    const state = stateIn("detail", "results");
    expect(phoneModeReducer(state, { type: "SEARCH_FOCUS", startQuery: "" })).toBe(state);
  });
});

describe("phoneModeReducer — SEARCH_COMMIT", () => {
  it("goes to results with bgContent=results from any screen", () => {
    for (const screen of ["home", "compose", "results"] as const) {
      const next = phoneModeReducer(stateIn(screen), { type: "SEARCH_COMMIT" });
      expect(next.screen).toBe("results");
      expect(next.bgContent).toBe("results");
      expect(next.transition.reason).toBe("search-commit");
    }
  });

  it("direction is forward from home", () => {
    const next = phoneModeReducer(stateIn("home"), { type: "SEARCH_COMMIT" });
    expect(next.transition.direction).toBe("forward");
  });
});

describe("phoneModeReducer — SEARCH_CLEAR", () => {
  it("goes to home with bgContent=home and reason=search-clear", () => {
    const next = phoneModeReducer(stateIn("results", "results"), { type: "SEARCH_CLEAR" });
    expect(next.screen).toBe("home");
    expect(next.bgContent).toBe("home");
    expect(next.transition.reason).toBe("search-clear");
  });

  it("transition reason is search-clear (triggers the scroll-to-top effect)", () => {
    const next = phoneModeReducer(stateIn("results", "results"), { type: "SEARCH_CLEAR" });
    expect(next.transition.reason).toBe("search-clear");
  });

  it("direction is back", () => {
    const next = phoneModeReducer(stateIn("results", "results"), { type: "SEARCH_CLEAR" });
    expect(next.transition.direction).toBe("back");
  });
});

describe("phoneModeReducer — COMPOSE_DISMISS", () => {
  it("compose with bgContent=home → home", () => {
    const next = phoneModeReducer(stateIn("compose", "home"), { type: "COMPOSE_DISMISS" });
    expect(next.screen).toBe("home");
    expect(next.transition.reason).toBe("compose-dismiss");
  });

  it("compose with bgContent=results → results (regression: must not land on home)", () => {
    const next = phoneModeReducer(stateIn("compose", "results"), { type: "COMPOSE_DISMISS" });
    expect(next.screen).toBe("results");
    expect(next.transition.reason).toBe("compose-dismiss");
  });

  it("from non-compose is a no-op", () => {
    for (const screen of ["home", "results", "detail"] as const) {
      const state = stateIn(screen);
      expect(phoneModeReducer(state, { type: "COMPOSE_DISMISS" })).toBe(state);
    }
  });
});

describe("phoneModeReducer — DETAIL_OPEN", () => {
  it("home → detail with bgContent=home", () => {
    const next = phoneModeReducer(stateIn("home", "home"), { type: "DETAIL_OPEN" });
    expect(next.screen).toBe("detail");
    expect(next.bgContent).toBe("home");
    expect(next.transition.reason).toBe("detail-open");
  });

  it("results → detail with bgContent=results", () => {
    const next = phoneModeReducer(stateIn("results", "results"), { type: "DETAIL_OPEN" });
    expect(next.screen).toBe("detail");
    expect(next.bgContent).toBe("results");
  });

  it("compose with bgContent=results → detail with bgContent=results (not home)", () => {
    // Regression: original code used contentModeFor(currentMode) which returned "home" for compose.
    const next = phoneModeReducer(stateIn("compose", "results"), { type: "DETAIL_OPEN" });
    expect(next.screen).toBe("detail");
    expect(next.bgContent).toBe("results");
  });

  it("from detail is a no-op", () => {
    const state = stateIn("detail", "home");
    expect(phoneModeReducer(state, { type: "DETAIL_OPEN" })).toBe(state);
  });

  it("direction is forward", () => {
    const next = phoneModeReducer(stateIn("results", "results"), { type: "DETAIL_OPEN" });
    expect(next.transition.direction).toBe("forward");
  });
});

describe("phoneModeReducer — DETAIL_CLOSE", () => {
  it("detail with bgContent=home → home", () => {
    const next = phoneModeReducer(stateIn("detail", "home"), { type: "DETAIL_CLOSE" });
    expect(next.screen).toBe("home");
    expect(next.transition.reason).toBe("detail-close");
  });

  it("detail with bgContent=results → results", () => {
    const next = phoneModeReducer(stateIn("detail", "results"), { type: "DETAIL_CLOSE" });
    expect(next.screen).toBe("results");
  });

  it("direction is back", () => {
    const next = phoneModeReducer(stateIn("detail", "results"), { type: "DETAIL_CLOSE" });
    expect(next.transition.direction).toBe("back");
  });

  it("from non-detail is a no-op", () => {
    for (const screen of ["home", "compose", "results"] as const) {
      const state = stateIn(screen);
      expect(phoneModeReducer(state, { type: "DETAIL_CLOSE" })).toBe(state);
    }
  });
});

describe("phoneModeReducer — SIMILAR_SEARCH", () => {
  it("always goes to results with bgContent=results", () => {
    for (const screen of ["home", "results", "detail"] as const) {
      const next = phoneModeReducer(stateIn(screen), { type: "SIMILAR_SEARCH" });
      expect(next.screen).toBe("results");
      expect(next.bgContent).toBe("results");
      expect(next.transition.reason).toBe("similar-search");
    }
  });
});

describe("phoneModeReducer — TARGET_RESET", () => {
  it("detail → home with bgContent=home", () => {
    const next = phoneModeReducer(stateIn("detail", "results"), { type: "TARGET_RESET" });
    expect(next.screen).toBe("home");
    expect(next.bgContent).toBe("home");
    expect(next.transition.reason).toBe("target-reset");
  });

  it("from non-detail is a no-op", () => {
    for (const screen of ["home", "compose", "results"] as const) {
      const state = stateIn(screen);
      expect(phoneModeReducer(state, { type: "TARGET_RESET" })).toBe(state);
    }
  });
});

describe("phoneModeReducer — transition metadata", () => {
  it("key increments on every real transition", () => {
    const s0 = initialPhoneModeState;
    const s1 = phoneModeReducer(s0, { type: "SEARCH_COMMIT" });
    const s2 = phoneModeReducer(s1, { type: "DETAIL_OPEN" });
    expect(s1.transition.key).toBe(1);
    expect(s2.transition.key).toBe(2);
  });

  it("key does not change on no-op", () => {
    const state = stateIn("home");
    const next = phoneModeReducer(state, { type: "COMPOSE_DISMISS" });
    expect(next.transition.key).toBe(state.transition.key);
  });

  it("from and to record the actual screens", () => {
    const next = phoneModeReducer(stateIn("home"), { type: "SEARCH_COMMIT" });
    expect(next.transition.from).toBe("home");
    expect(next.transition.to).toBe("results");
  });
});

describe("phoneModeReducer — multi-step flows", () => {
  it("home → focus → commit → open detail → close → lands on results", () => {
    let s = initialPhoneModeState;
    s = phoneModeReducer(s, { type: "SEARCH_FOCUS", startQuery: "sunset" });
    s = phoneModeReducer(s, { type: "SEARCH_COMMIT" });
    s = phoneModeReducer(s, { type: "DETAIL_OPEN" });
    s = phoneModeReducer(s, { type: "DETAIL_CLOSE" });
    expect(s.screen).toBe("results");
    expect(s.bgContent).toBe("results");
  });

  it("home → focus → dismiss → lands back on home (not results)", () => {
    let s = initialPhoneModeState;
    s = phoneModeReducer(s, { type: "SEARCH_FOCUS", startQuery: "draft" });
    s = phoneModeReducer(s, { type: "COMPOSE_DISMISS" });
    expect(s.screen).toBe("home");
    expect(s.bgContent).toBe("home");
  });

  it("results → focus → dismiss → lands back on results", () => {
    let s = initialPhoneModeState;
    s = phoneModeReducer(s, { type: "SEARCH_COMMIT" });
    s = phoneModeReducer(s, { type: "SEARCH_FOCUS", startQuery: "refine" });
    s = phoneModeReducer(s, { type: "COMPOSE_DISMISS" });
    expect(s.screen).toBe("results");
    expect(s.bgContent).toBe("results");
  });

  it("detail → similar search → results, not back to home", () => {
    let s = initialPhoneModeState;
    s = phoneModeReducer(s, { type: "DETAIL_OPEN" });
    s = phoneModeReducer(s, { type: "SIMILAR_SEARCH" });
    expect(s.screen).toBe("results");
    expect(s.bgContent).toBe("results");
  });

  it("composeStartQuery is available to restore on dismiss", () => {
    let s = initialPhoneModeState;
    s = phoneModeReducer(s, { type: "SEARCH_COMMIT" });
    s = phoneModeReducer(s, { type: "SEARCH_FOCUS", startQuery: "previously committed" });
    expect(s.composeStartQuery).toBe("previously committed");
    // Dismiss doesn't clear composeStartQuery from state — component uses it before dispatching
    s = phoneModeReducer(s, { type: "COMPOSE_DISMISS" });
    expect(s.composeStartQuery).toBe("previously committed");
  });

  it("double focus from compose is a single transition (no stack overflow)", () => {
    let s = initialPhoneModeState;
    s = phoneModeReducer(s, { type: "SEARCH_FOCUS", startQuery: "a" });
    const keyAfterFirst = s.transition.key;
    s = phoneModeReducer(s, { type: "SEARCH_FOCUS", startQuery: "b" });
    expect(s.screen).toBe("compose");
    expect(s.transition.key).toBe(keyAfterFirst); // no-op, key unchanged
  });
});
