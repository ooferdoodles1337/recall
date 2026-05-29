import { expect, type Locator, type Page, type Route, test, type TestInfo } from "@playwright/test";
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

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function limitParam(url: URL, fallback: number) {
  const raw = url.searchParams.get("limit") ?? url.searchParams.get("n");
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resultsForQuery(url: URL, fallback: RecallSearchResult[]) {
  const query = url.searchParams.get("q") ?? "";
  if (query === "2024-03-18") return dateResults;
  if (query.toLowerCase().includes("empty")) return [];
  return fallback;
}

async function installPhoneApiMocks(page: Page) {
  await page.route("**/catalog/items**", async (route) => {
    const url = new URL(route.request().url());
    const isFavorite = url.searchParams.get("favorite") === "true";
    const source: RecallMediaItem[] = isFavorite ? favoriteItems : recentItems;
    const results = source.slice(0, limitParam(url, source.length));
    await fulfillJson(route, { count: results.length, results });
  });

  await page.route("**/search/suggest**", async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, { suggestions: defaultSuggestions.slice(0, limitParam(url, defaultSuggestions.length)) });
  });

  await page.route("**/search/semantic**", async (route) => {
    const url = new URL(route.request().url());
    const results = resultsForQuery(url, semanticResults).slice(0, limitParam(url, 50));
    await fulfillJson(route, { query: url.searchParams.get("q") ?? "", results });
  });

  await page.route("**/search/text**", async (route) => {
    const url = new URL(route.request().url());
    const results = resultsForQuery(url, textResults).slice(0, limitParam(url, 30));
    await fulfillJson(route, { query: url.searchParams.get("q") ?? "", results });
  });

  await page.route("**/search/similar/**", async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, {
      query_id: url.pathname.split("/").pop() ?? "unknown",
      results: similarResults.slice(0, limitParam(url, 50)),
    });
  });

  await page.route("**/media/**", async (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/media/")) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
}

async function gotoPhone(page: Page) {
  await installPhoneApiMocks(page);
  await page.goto("/phone");
  await expect(page.getByRole("button", { name: /Select Favorite 01/i })).toBeVisible();
}

async function runSearch(page: Page, query = "sunset") {
  await page.getByLabel("Search your media").first().fill(query);
  await expect(page.getByRole("button", { name: /sunset picnic/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Select Sunset pier photo/i })).toBeVisible();
}

async function scrollPhoneViewport(page: Page, top: number) {
  await page.locator(".phone-rect-viewport").evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, top);
}

async function box(locator: Locator) {
  const currentBox = await locator.boundingBox();
  expect(currentBox).not.toBeNull();
  return currentBox!;
}

async function longPress(locator: Locator, page: Page) {
  const targetBox = await box(locator);
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(620);
  await page.mouse.up();
}

function alphaFromColor(color: string) {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(",").map((part) => part.trim());
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

async function computedLayerStyle(locator: Locator) {
  return locator.first().evaluate((element) => {
    const styles = window.getComputedStyle(element);
    const webkitStyles = styles as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    return {
      backdropFilter: styles.backdropFilter || webkitStyles.webkitBackdropFilter || "none",
      backgroundColor: styles.backgroundColor,
      borderColor: styles.borderColor,
      bottom: styles.bottom,
      paddingBottom: styles.paddingBottom,
      pointerEvents: styles.pointerEvents,
      position: styles.position,
      zIndex: styles.zIndex,
    };
  });
}

async function expectGlass(locator: Locator, options: { requireBorder?: boolean } = {}) {
  const styles = await computedLayerStyle(locator);
  expect(alphaFromColor(styles.backgroundColor)).toBeLessThan(1);
  expect(styles.backdropFilter).not.toBe("none");
  if (options.requireBorder ?? true) {
    expect(alphaFromColor(styles.borderColor)).toBeGreaterThan(0);
  }
}

async function expectTopmost(locator: Locator) {
  await expect(locator).toBeVisible();
  const isTopmost = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return topElement === element || element.contains(topElement);
  });
  expect(isTopmost).toBe(true);
}

async function saveSmokeScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

test.describe("phone layout and layer behavior", () => {
  test("keeps home and results search controls sticky without hiding grid content", async ({ page }, testInfo) => {
    await gotoPhone(page);
    await saveSmokeScreenshot(page, testInfo, "home");

    const phone = page.locator(".phone-rect");
    const homeStickySearch = page.locator(".phone-startpage-search-sticky");
    const firstFavoriteTopBefore = await page
      .locator('[data-phone-grid-scope="favorites"] [data-phone-grid-item]')
      .first()
      .evaluate((element) => element.getBoundingClientRect().top);

    await scrollPhoneViewport(page, 320);
    await page.waitForTimeout(60);

    const phoneBox = await box(phone);
    const stickyBox = await box(homeStickySearch);
    const firstFavoriteTopAfter = await page
      .locator('[data-phone-grid-scope="favorites"] [data-phone-grid-item]')
      .first()
      .evaluate((element) => element.getBoundingClientRect().top);

    expect(stickyBox.y).toBeLessThanOrEqual(phoneBox.y + 2);
    expect(firstFavoriteTopAfter).toBeLessThan(firstFavoriteTopBefore);

    await runSearch(page);
    await saveSmokeScreenshot(page, testInfo, "results");

    const persistentSearch = page.locator(".phone-persistent-search");
    const persistentBefore = await box(persistentSearch);
    const searchGridTop = await page
      .locator('[data-phone-grid-scope="search"]')
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(searchGridTop).toBeGreaterThanOrEqual(persistentBefore.y + persistentBefore.height - 4);

    await scrollPhoneViewport(page, 420);
    await page.waitForTimeout(60);
    const persistentAfter = await box(persistentSearch);
    expect(Math.abs(persistentAfter.y - persistentBefore.y)).toBeLessThanOrEqual(1);
  });

  test("orders overlays so trays, details, NSFW dialogs, and pull indicators do not fight each other", async ({ page }, testInfo) => {
    await gotoPhone(page);
    await runSearch(page);

    await page.getByRole("button", { name: /Select Sunset pier photo/i }).click();
    const tray = page.getByRole("region", { name: "Selection tray" });
    await expectTopmost(tray);
    await saveSmokeScreenshot(page, testInfo, "selected-tray");

    const viewportPadding = await computedLayerStyle(page.locator(".phone-rect-viewport"));
    expect(Number.parseFloat(viewportPadding.paddingBottom)).toBeGreaterThan(130);

    await longPress(page.getByRole("button", { name: /Deselect Sunset pier photo/i }), page);
    const detail = page.locator(".detail-screen");
    await expect(detail).toBeVisible();
    await expect(tray).toHaveCount(0);
    await saveSmokeScreenshot(page, testInfo, "detail");

    const detailIsAboveSearch = await page.locator(".phone-rect").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + 28)?.closest(".detail-screen") !== null;
    });
    expect(detailIsAboveSearch).toBe(true);
    expect(Number((await computedLayerStyle(detail)).zIndex)).toBeGreaterThan(
      Number((await computedLayerStyle(page.locator(".phone-persistent-search"))).zIndex),
    );

    await page.getByRole("button", { name: "Back" }).click();
    await expect(detail).toHaveCount(0);

    await page.getByRole("button", { name: /Sensitive content/i }).first().click();
    const nsfwDialog = page.getByRole("dialog", { name: "Sensitive content warning" });
    await expect(nsfwDialog).toBeVisible();
    await saveSmokeScreenshot(page, testInfo, "nsfw-dialog");
    await expectTopmost(page.locator(".nsfw-backdrop"));
    expect(Number((await computedLayerStyle(page.locator(".nsfw-backdrop"))).zIndex)).toBeGreaterThan(50);

    const pullIndicatorStyle = await computedLayerStyle(page.locator(".pull-indicator"));
    expect(pullIndicatorStyle.pointerEvents).toBe("none");
    expect(Number(pullIndicatorStyle.zIndex)).toBeLessThan(30);
  });

  test("keeps translucent glass styling on the phone layers that depend on depth", async ({ page }, testInfo) => {
    await gotoPhone(page);
    await runSearch(page);

    await expectGlass(page.locator(".search-bar--semantic").first());
    await expectGlass(page.locator(".phone-grid-zoom-controls").first());
    await expectGlass(page.locator(".video-badge").first(), { requireBorder: false });

    await page.getByRole("button", { name: /Select Sunset pier photo/i }).click();
    await expectGlass(page.locator(".selection-tray"));

    await longPress(page.getByRole("button", { name: /Deselect Sunset pier photo/i }), page);
    await expectGlass(page.locator(".detail-float-action").first());

    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: /Sensitive content/i }).first().click();
    await expectGlass(page.locator(".nsfw-backdrop"), { requireBorder: false });

    await saveSmokeScreenshot(page, testInfo, "glass-layers");
  });

  test("captures typing suggestions and NSFW reveal visual smoke states", async ({ page }, testInfo) => {
    await gotoPhone(page);

    await page.getByLabel("Search your media").first().fill("sunset");
    await expect(page.getByRole("button", { name: /sunset picnic/i })).toBeVisible();
    await saveSmokeScreenshot(page, testInfo, "typing-suggestions");

    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Select Sunset pier photo/i })).toBeVisible();

    await page.getByRole("button", { name: /Sensitive content/i }).first().click();
    await expect(page.getByRole("dialog", { name: "Sensitive content warning" })).toBeVisible();
    await saveSmokeScreenshot(page, testInfo, "nsfw-before-reveal");

    await page.getByRole("button", { name: "Reveal This One" }).click();
    await expect(page.getByRole("button", { name: /Select Sensitive search result/i })).toBeVisible();
    await saveSmokeScreenshot(page, testInfo, "nsfw-after-reveal");
  });
});
