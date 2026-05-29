import { recallFetch } from "@/shared/api/client";
import type { RecallMediaItem, RecallSearchResult } from "@/shared/types/recall";

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

interface RecallRequestOptions {
  signal?: AbortSignal;
}

export function searchText(query: string, count = 20, options?: RecallRequestOptions) {
  const params = new URLSearchParams({ q: query, n: String(count) });
  return recallFetch<RecallSearchResponse>(`/search/text?${params.toString()}`, { signal: options?.signal });
}

export function searchSemantic(query: string, count = 20, options?: RecallRequestOptions) {
  const params = new URLSearchParams({ q: query, n: String(count) });
  return recallFetch<RecallSearchResponse>(`/search/semantic?${params.toString()}`, { signal: options?.signal });
}

export function suggestSearches(query: string, count = 6, options?: RecallRequestOptions) {
  const params = new URLSearchParams({ q: query, n: String(count) });
  return recallFetch<RecallSuggestionsResponse>(`/search/suggest?${params.toString()}`, { signal: options?.signal });
}

export function searchSimilarById(id: string, count = 20, options?: RecallRequestOptions) {
  const params = new URLSearchParams({ n: String(count) });
  return recallFetch<RecallSimilarResponse>(`/search/similar/${encodeURIComponent(id)}?${params.toString()}`, { signal: options?.signal });
}

export function listRecentItems(count = 51, options?: RecallRequestOptions) {
  const params = new URLSearchParams({ order: "desc", limit: String(count) });
  return recallFetch<RecallCatalogItemsResponse>(`/catalog/items?${params.toString()}`, { signal: options?.signal })
    .then((response) => ({
      ...response,
      results: response.results.slice(0, count),
    }));
}

export function listFavoriteItems(count = 34, options?: RecallRequestOptions) {
  const params = new URLSearchParams({ favorite: "true", order: "desc", limit: String(count) });
  return recallFetch<RecallCatalogItemsResponse>(`/catalog/items?${params.toString()}`, { signal: options?.signal })
    .then((response) => ({
      ...response,
      results: response.results.slice(0, count),
    }));
}

export function patchCatalogItem(id: string, patch: Record<string, unknown>) {
  return recallFetch<RecallMediaItem>(`/catalog/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
