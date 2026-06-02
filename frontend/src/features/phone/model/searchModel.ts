import type { RecallMediaItem } from "@/shared/types/recall";
import { readSearchHistory, SEARCH_BATCH_SIZE } from "../phoneUtils";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type SearchState = {
  query: string;
  submittedQuery: string;
  dateBrowseContext: { prefix: string; label: string } | null;
  similarSourceItem: RecallMediaItem | null;
  results: RecallMediaItem[];
  isLoading: boolean;
  errorMessage: string | null;
  visibleCount: number;
  isLoadingMore: boolean;
  isAutoSearchPending: boolean;
  prefetchedResults: RecallMediaItem[] | null;
  showHistory: boolean;
  showComposePanel: boolean;
  history: string[];
};

export const initialSearchState: SearchState = {
  query: "",
  submittedQuery: "",
  dateBrowseContext: null,
  similarSourceItem: null,
  results: [],
  isLoading: false,
  errorMessage: null,
  visibleCount: SEARCH_BATCH_SIZE,
  isLoadingMore: false,
  isAutoSearchPending: false,
  prefetchedResults: null,
  showHistory: false,
  showComposePanel: true,
  history: readSearchHistory(),
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SearchAction =
  | { type: "QUERY_CHANGE"; query: string }
  | { type: "SEARCH_START"; submittedQuery: string; count: number }
  | { type: "SEARCH_ABORT" }
  | { type: "SEARCH_SUCCESS"; results: RecallMediaItem[] }
  | { type: "SEARCH_ERROR"; message: string }
  | { type: "SEARCH_CLEAR" }
  | { type: "DATE_BROWSE_START"; prefix: string; label: string }
  | { type: "DATE_BROWSE_SUCCESS"; results: RecallMediaItem[] }
  | { type: "DATE_BROWSE_ERROR" }
  | { type: "SIMILAR_START"; item: RecallMediaItem }
  | { type: "SIMILAR_SUCCESS"; results: RecallMediaItem[] }
  | { type: "SIMILAR_ERROR" }
  | { type: "SIMILAR_CLEAR" }
  | { type: "LOAD_MORE_START" }
  | { type: "LOAD_MORE_SUCCESS"; results: RecallMediaItem[]; nextCount: number }
  | { type: "LOAD_MORE_END" }
  | { type: "PREFETCH_SUCCESS"; results: RecallMediaItem[] }
  | { type: "PREFETCH_CLEAR" }
  | { type: "PREFETCH_APPLY"; nextCount: number }
  | { type: "HISTORY_SET"; history: string[] }
  | { type: "HISTORY_REMOVE"; item: string }
  | { type: "HISTORY_CLEAR" }
  | { type: "SHOW_HISTORY_SET"; show: boolean }
  | { type: "COMPOSE_PANEL_SET"; show: boolean }
  | { type: "AUTO_SEARCH_PENDING_SET"; pending: boolean }
  | { type: "SET_ERROR"; message: string | null }
  | { type: "ITEM_UPDATE"; updated: RecallMediaItem };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "QUERY_CHANGE":
      return { ...state, query: action.query };

    case "SEARCH_START":
      return {
        ...state,
        isLoading: true,
        errorMessage: null,
        results: [],
        visibleCount: action.count,
        showHistory: false,
        dateBrowseContext: null,
        submittedQuery: action.submittedQuery,
        similarSourceItem: null,
        isLoadingMore: false,
      };

    case "SEARCH_ABORT":
      return { ...state, isLoading: false };

    case "SEARCH_SUCCESS":
      return { ...state, isLoading: false, results: action.results };

    case "SEARCH_ERROR":
      return { ...state, isLoading: false, errorMessage: action.message };

    case "SEARCH_CLEAR":
      return {
        ...state,
        query: "",
        submittedQuery: "",
        dateBrowseContext: null,
        similarSourceItem: null,
        results: [],
        showHistory: false,
        isLoading: false,
        isLoadingMore: false,
        history: readSearchHistory(),
      };

    case "DATE_BROWSE_START":
      return {
        ...state,
        isLoading: true,
        errorMessage: null,
        results: [],
        visibleCount: SEARCH_BATCH_SIZE,
        showHistory: false,
        query: "",
        submittedQuery: action.label,
        dateBrowseContext: { prefix: action.prefix, label: action.label },
        isLoadingMore: false,
      };

    case "DATE_BROWSE_SUCCESS":
      return { ...state, isLoading: false, results: action.results };

    case "DATE_BROWSE_ERROR":
      return { ...state, isLoading: false, errorMessage: "Couldn't load items from this date.", results: [] };

    case "SIMILAR_START":
      return {
        ...state,
        isLoading: true,
        errorMessage: null,
        results: [],
        dateBrowseContext: null,
        similarSourceItem: action.item,
        submittedQuery: "similar items",
        query: "",
      };

    case "SIMILAR_SUCCESS":
      return { ...state, isLoading: false, results: action.results };

    case "SIMILAR_ERROR":
      return {
        ...state,
        isLoading: false,
        errorMessage: "Similar search is available after this item has an indexed embedding.",
        results: [],
      };

    case "SIMILAR_CLEAR":
      return { ...state, similarSourceItem: null };

    case "LOAD_MORE_START":
      return { ...state, isLoadingMore: true };

    case "LOAD_MORE_SUCCESS":
      return { ...state, isLoadingMore: false, results: action.results, visibleCount: action.nextCount };

    case "LOAD_MORE_END":
      return { ...state, isLoadingMore: false };

    case "PREFETCH_SUCCESS":
      return { ...state, prefetchedResults: action.results };

    case "PREFETCH_CLEAR":
      return { ...state, prefetchedResults: null };

    case "PREFETCH_APPLY":
      return {
        ...state,
        results: state.prefetchedResults ?? state.results,
        visibleCount: action.nextCount,
        errorMessage: null,
        prefetchedResults: null,
      };

    case "HISTORY_SET":
      return { ...state, history: action.history };

    case "HISTORY_REMOVE": {
      const next = state.history.filter((h) => h.toLowerCase() !== action.item.toLowerCase());
      return { ...state, history: next };
    }

    case "HISTORY_CLEAR":
      return { ...state, history: [] };

    case "SHOW_HISTORY_SET":
      return { ...state, showHistory: action.show };

    case "COMPOSE_PANEL_SET":
      return { ...state, showComposePanel: action.show };

    case "AUTO_SEARCH_PENDING_SET":
      return { ...state, isAutoSearchPending: action.pending };

    case "SET_ERROR":
      return { ...state, errorMessage: action.message };

    case "ITEM_UPDATE": {
      const replace = (items: RecallMediaItem[]) =>
        items.map((item) => (item.id === action.updated.id ? action.updated : item));
      return {
        ...state,
        results: replace(state.results),
        prefetchedResults: state.prefetchedResults ? replace(state.prefetchedResults) : null,
      };
    }
  }
}
