import { recallFetch } from "../../shared/api/client";
import type { RecallMediaItem, RecallSearchResult } from "../../shared/types/recall";

export interface RecallSearchResponse {
  query: string;
  results: RecallSearchResult[];
}

export interface RecallSuggestionsResponse {
  suggestions: string[];
}

export interface RecallCatalogItemsResponse {
  count: number;
  results: RecallMediaItem[];
}

export interface RecallSimilarResponse {
  query_id: string;
  results: RecallSearchResult[];
}

export function searchText(query: string, count = 20) {
  const params = new URLSearchParams({ q: query, n: String(count) });
  return recallFetch<RecallSearchResponse>(`/search/text?${params.toString()}`);
}

export function searchSemantic(query: string, count = 20) {
  const params = new URLSearchParams({ q: query, n: String(count) });
  return recallFetch<RecallSearchResponse>(`/search/semantic?${params.toString()}`);
}

export function suggestSearches(query: string, count = 6) {
  const params = new URLSearchParams({ q: query, n: String(count) });
  return recallFetch<RecallSuggestionsResponse>(`/search/suggest?${params.toString()}`);
}

export function searchSimilarById(id: string, count = 20) {
  const params = new URLSearchParams({ n: String(count) });
  return recallFetch<RecallSimilarResponse>(`/search/similar/${encodeURIComponent(id)}?${params.toString()}`);
}

export function listRecentItems(count = 18) {
  return recallFetch<RecallCatalogItemsResponse>("/catalog/items?order=desc")
    .then((response) => ({
      ...response,
      results: response.results.slice(0, count),
    }));
}
