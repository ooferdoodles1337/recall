import { http, HttpResponse } from "msw";
import {
  dateResults,
  defaultSuggestions,
  favoriteItems,
  recentItems,
  semanticResults,
  similarResults,
  textResults,
} from "../fixtures/phoneData";
import type { RecallMediaItem, RecallSearchResult } from "../../src/shared/types/recall";

interface PhoneMockState {
  favoriteItems: RecallMediaItem[];
  recentItems: RecallMediaItem[];
  semanticResults: RecallSearchResult[];
  textResults: RecallSearchResult[];
  dateResults: RecallSearchResult[];
  similarResults: RecallSearchResult[];
  suggestions: string[];
  failSemantic: boolean;
  failText: boolean;
  failSimilar: boolean;
  requests: string[];
}

const initialState = (): PhoneMockState => ({
  favoriteItems,
  recentItems,
  semanticResults,
  textResults,
  dateResults,
  similarResults,
  suggestions: defaultSuggestions,
  failSemantic: false,
  failText: false,
  failSimilar: false,
  requests: [],
});

export const phoneMockState: PhoneMockState = initialState();

export function resetPhoneMockState() {
  Object.assign(phoneMockState, initialState());
}

function limitParam(url: URL, fallback: number) {
  const raw = url.searchParams.get("limit") ?? url.searchParams.get("n");
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function searchResultsForQuery(url: URL, fallback: RecallSearchResult[]) {
  const query = url.searchParams.get("q") ?? "";
  if (query === "2024-03-18") return phoneMockState.dateResults;
  if (query.toLowerCase().includes("empty")) return [];
  return fallback;
}

export function phoneHandlers() {
  return [
    http.get("*/catalog/items", ({ request }) => {
      const url = new URL(request.url);
      phoneMockState.requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      const isFavorite = url.searchParams.get("favorite") === "true";
      const source = isFavorite ? phoneMockState.favoriteItems : phoneMockState.recentItems;
      const limit = limitParam(url, source.length);
      const results = source.slice(0, limit);
      return HttpResponse.json({ count: results.length, results });
    }),

    http.get("*/search/suggest", ({ request }) => {
      const url = new URL(request.url);
      phoneMockState.requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      const limit = limitParam(url, phoneMockState.suggestions.length);
      return HttpResponse.json({ suggestions: phoneMockState.suggestions.slice(0, limit) });
    }),

    http.get("*/search/semantic", ({ request }) => {
      const url = new URL(request.url);
      phoneMockState.requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      if (phoneMockState.failSemantic) {
        return HttpResponse.error();
      }
      const results = searchResultsForQuery(url, phoneMockState.semanticResults).slice(0, limitParam(url, 50));
      return HttpResponse.json({ query: url.searchParams.get("q") ?? "", results });
    }),

    http.get("*/search/text", ({ request }) => {
      const url = new URL(request.url);
      phoneMockState.requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      if (phoneMockState.failText) {
        return HttpResponse.error();
      }
      const results = searchResultsForQuery(url, phoneMockState.textResults).slice(0, limitParam(url, 30));
      return HttpResponse.json({ query: url.searchParams.get("q") ?? "", results });
    }),

    http.get("*/search/similar/:id", ({ params, request }) => {
      const url = new URL(request.url);
      phoneMockState.requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      if (phoneMockState.failSimilar) {
        return HttpResponse.error();
      }
      return HttpResponse.json({
        query_id: String(params.id),
        results: phoneMockState.similarResults.slice(0, limitParam(url, 50)),
      });
    }),
  ];
}
