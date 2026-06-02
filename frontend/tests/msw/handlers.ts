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
  if (query.toLowerCase().includes("empty")) return [];
  return fallback;
}

function dateItemsForPrefix(prefix: string) {
  return phoneMockState.dateResults.filter((item) => {
    const sortKey = item.metadata.capture?.sort_key ?? item.metadata.capture?.taken_at;
    const date = item.metadata.capture?.date;
    return sortKey?.startsWith(prefix) || date?.startsWith(prefix);
  });
}

function patchItem<T extends RecallMediaItem>(item: T, patch: Partial<RecallMediaItem["metadata"]>): T {
  return {
    ...item,
    metadata: {
      ...item.metadata,
      ...patch,
      asset: patch.asset ? { ...item.metadata.asset, ...patch.asset } : item.metadata.asset,
      capture: patch.capture ? { ...item.metadata.capture, ...patch.capture } : item.metadata.capture,
      organization: patch.organization ? { ...item.metadata.organization, ...patch.organization } : item.metadata.organization,
      safety: patch.safety ? { ...item.metadata.safety, ...patch.safety } : item.metadata.safety,
      search: patch.search ? { ...item.metadata.search, ...patch.search } : item.metadata.search,
    },
  } as T;
}

function patchItems<T extends RecallMediaItem>(items: T[], id: string, patch: Partial<RecallMediaItem["metadata"]>) {
  return items.map((item) => item.id === id ? patchItem(item, patch) : item);
}

export function phoneHandlers() {
  return [
    http.get("*/catalog/items", ({ request }) => {
      const url = new URL(request.url);
      phoneMockState.requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      const isFavorite = url.searchParams.get("favorite") === "true";
      const datePrefix = url.searchParams.get("date_prefix");
      const source = datePrefix ? dateItemsForPrefix(datePrefix) : isFavorite ? phoneMockState.favoriteItems : phoneMockState.recentItems;
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

    http.patch("*/catalog/items/:id", async ({ params, request }) => {
      const id = String(params.id);
      const patch = await request.json() as Partial<RecallMediaItem["metadata"]>;
      phoneMockState.requests.push(`/catalog/items/${id}`);
      const allItems = [
        ...phoneMockState.favoriteItems,
        ...phoneMockState.recentItems,
        ...phoneMockState.semanticResults,
        ...phoneMockState.textResults,
        ...phoneMockState.dateResults,
        ...phoneMockState.similarResults,
      ];
      const current = allItems.find((item) => item.id === id);
      if (!current) return HttpResponse.json({ error: "Not found" }, { status: 404 });
      const updated = patchItem(current, patch);
      phoneMockState.favoriteItems = patchItems(phoneMockState.favoriteItems, id, patch);
      phoneMockState.recentItems = patchItems(phoneMockState.recentItems, id, patch);
      phoneMockState.semanticResults = patchItems(phoneMockState.semanticResults, id, patch);
      phoneMockState.textResults = patchItems(phoneMockState.textResults, id, patch);
      phoneMockState.dateResults = patchItems(phoneMockState.dateResults, id, patch);
      phoneMockState.similarResults = patchItems(phoneMockState.similarResults, id, patch);
      return HttpResponse.json(updated);
    }),
  ];
}
