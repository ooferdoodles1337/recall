export type PhoneScreen = "home" | "compose" | "results" | "detail";
export type PhoneBgContent = "home" | "results";
export type MotionDirection = "forward" | "back" | "neutral";
export type ModeTransitionReason =
  | "initial"
  | "target-reset"
  | "search-focus"
  | "search-clear"
  | "search-commit"
  | "compose-dismiss"
  | "similar-search"
  | "detail-open"
  | "detail-close";

export interface ModeTransition {
  from: PhoneScreen;
  to: PhoneScreen;
  direction: MotionDirection;
  reason: ModeTransitionReason;
  key: number;
}

export interface PhoneModeState {
  screen: PhoneScreen;
  /** The content layer rendered beneath any overlay (compose or detail). */
  bgContent: PhoneBgContent;
  /** Query value at the moment compose was entered, restored on dismiss. */
  composeStartQuery: string;
  transition: ModeTransition;
}

export type PhoneModeAction =
  | { type: "SEARCH_FOCUS"; startQuery: string }
  | { type: "SEARCH_COMMIT" }
  | { type: "SEARCH_CLEAR" }
  | { type: "COMPOSE_DISMISS" }
  | { type: "SIMILAR_SEARCH" }
  | { type: "DETAIL_OPEN" }
  | { type: "DETAIL_CLOSE" }
  | { type: "TARGET_RESET" };

const SCREEN_DEPTH: Record<PhoneScreen, number> = {
  home: 0,
  compose: 1,
  results: 2,
  detail: 3,
};

function screenDirection(from: PhoneScreen, to: PhoneScreen): MotionDirection {
  const delta = SCREEN_DEPTH[to] - SCREEN_DEPTH[from];
  if (delta > 0) return "forward";
  if (delta < 0) return "back";
  return "neutral";
}

export const initialPhoneModeState: PhoneModeState = {
  screen: "home",
  bgContent: "home",
  composeStartQuery: "",
  transition: {
    from: "home",
    to: "home",
    direction: "neutral",
    reason: "initial",
    key: 0,
  },
};

export function phoneModeReducer(state: PhoneModeState, action: PhoneModeAction): PhoneModeState {
  const from = state.screen;

  function to(
    screen: PhoneScreen,
    reason: ModeTransitionReason,
    updates: Partial<Omit<PhoneModeState, "screen" | "transition">> = {},
  ): PhoneModeState {
    return {
      ...state,
      screen,
      ...updates,
      transition: {
        from,
        to: screen,
        direction: screenDirection(from, screen),
        reason,
        key: state.transition.key + 1,
      },
    };
  }

  switch (action.type) {
    case "SEARCH_FOCUS":
      if (state.screen === "detail" || state.screen === "compose") return state;
      // bgContent is already tracking the current content layer, preserve it.
      return to("compose", "search-focus", { composeStartQuery: action.startQuery });

    case "SEARCH_COMMIT":
      return to("results", "search-commit", { bgContent: "results" });

    case "SEARCH_CLEAR":
      return to("home", "search-clear", { bgContent: "home" });

    case "COMPOSE_DISMISS":
      if (state.screen !== "compose") return state;
      return to(state.bgContent, "compose-dismiss");

    case "SIMILAR_SEARCH":
      return to("results", "similar-search", { bgContent: "results" });

    case "DETAIL_OPEN":
      if (state.screen === "detail") return state;
      // bgContent already reflects what sits beneath any current overlay.
      return to("detail", "detail-open");

    case "DETAIL_CLOSE":
      if (state.screen !== "detail") return state;
      return to(state.bgContent, "detail-close");

    case "TARGET_RESET":
      if (state.screen !== "detail") return state;
      return to("home", "target-reset", { bgContent: "home" });

    default:
      return state;
  }
}
