export const phoneQueryKeys = {
  catalog: () => ["catalog"] as const,
  favoritesAll: () => ["catalog", "favorites"] as const,
  favorites: (count: number) => ["catalog", "favorites", count] as const,
  recentAll: () => ["catalog", "recent"] as const,
  recent: (limit: number) => ["catalog", "recent", limit] as const,
  suggestions: (query: string) => ["suggestions", query] as const,
};
