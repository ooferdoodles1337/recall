import { describe, expect, it } from "vitest";
import { resolvedDisplayUrl, resolvedMediaUrl } from "@/shared/media/mediaItem";
import type { RecallMediaItem } from "@/shared/types/recall";

function makeItem(links: RecallMediaItem["links"]): RecallMediaItem {
  return {
    id: "x",
    metadata: { asset: { filename: "x.heic", media_type: "image", mime_type: "image/heic" } },
    links,
  };
}

describe("resolvedDisplayUrl", () => {
  it("resolves a relative display link against the API base", () => {
    const item = makeItem({ media: "/media/x", display: "/media/x/display" });
    // Default API base is "" in tests, so relative links pass through unchanged.
    expect(resolvedDisplayUrl(item)).toBe("/media/x/display");
  });

  it("passes through an absolute display link unchanged", () => {
    const item = makeItem({ display: "https://cdn.example/x.webp" });
    expect(resolvedDisplayUrl(item)).toBe("https://cdn.example/x.webp");
  });

  it("returns null when no display rendition exists", () => {
    const item = makeItem({ media: "/media/x" });
    expect(resolvedDisplayUrl(item)).toBeNull();
  });

  it("detail src precedence prefers display over media when present", () => {
    const item = makeItem({ media: "/media/x", display: "/media/x/display" });
    // Mirrors ImageDetailView/DetailViewChrome fallback ordering.
    const src = resolvedDisplayUrl(item) ?? resolvedMediaUrl(item) ?? item.links?.media;
    expect(src).toBe("/media/x/display");
  });

  it("detail src precedence falls back to media for web-native formats", () => {
    const item = makeItem({ media: "/media/y" });
    const src = resolvedDisplayUrl(item) ?? resolvedMediaUrl(item) ?? item.links?.media;
    expect(src).toBe("/media/y");
  });
});
