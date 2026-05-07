import { recallFetch } from "../../shared/api/client";
import type { RecallSearchResult } from "../../shared/types/recall";

export interface RecallSearchResponse {
  query: string;
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

