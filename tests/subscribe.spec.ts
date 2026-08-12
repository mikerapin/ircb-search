import { test, expect } from "@playwright/test";
import type { CoreData } from "../src/data/types";

const FEEDS = [
  "https://podcasts.apple.com/us/podcast/i-read-comic-books/id981964360",
  "https://open.spotify.com/show/2XNmyG7TfF3FzTqmGxLoIJ",
  "https://feeds.simplecast.com/U93zjuSN",
  "https://patreon.com/ircbpodcast",
];

test("subscribe offers every place to get the show", async ({ page }) => {
  await page.goto("/#/subscribe");
  await page.waitForSelector(".coupon");
  await expect(page.locator("#dressno")).toHaveText("Subscribe");
  await expect(page.locator(".pagehead h1")).toHaveText("Subscribe");
  for (const url of FEEDS) {
    await expect(page.locator(`#view .coupon a[href="${url}"]`)).toBeVisible();
  }
});

test("the page's links are the same ones the footer carries", async ({ page }) => {
  await page.goto("/#/subscribe");
  await page.waitForSelector(".coupon");
  const footer = await page.locator("footer a").evaluateAll(els => (els as HTMLAnchorElement[]).map(a => a.href));
  const view = await page.locator("#view .coupon a").evaluateAll(els => (els as HTMLAnchorElement[]).map(a => a.href));
  for (const url of view) expect(footer).toContain(url);
});

test("the Patreon shelf is real, not a placeholder", async ({ page }) => {
  await page.goto("/#/subscribe");
  await page.waitForSelector(".adslot");
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
  await expect(page.locator(".adslot")).toHaveCount(core.patreonSeries.length);
  const hrefs = await page.locator(".adslot").evaluateAll(els => els.map(a => a.getAttribute("href")));
  expect(hrefs.every(h => /^https:\/\/(www\.)?patreon\.com\//.test(h ?? ""))).toBe(true);
  // The episode count in the copy comes from the data, not from a number typed in 2026.
  await expect(page.locator(".pagehead")).toContainText(core.stats.episodes.toLocaleString("en-US"));
});

test("no route falls through to a placeholder except the wall", async ({ page }) => {
  const routes = ["/#/panel", "/#/subscribe", "/#/about", "/#/index"];
  for (const path of routes) {
    await page.goto(path);
    await page.waitForSelector("body[data-ready]");
    await page.waitForTimeout(250);
    // A stub is a lone pagehead with nothing under it.
    await expect(page.locator("#view section, #view .azgrid, #view .coupon").first()).toBeVisible();
  }
  await page.goto("/#/wall");
  await expect(page.locator(".pagehead h1")).toHaveText("The Wall");
});
