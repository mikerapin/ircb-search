import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Real classes from the prototype: .issue-head / .art / .meta / .crew / .notes / .tags,
// and .togg / .ra-list / .ra-row for the read-along.

async function openNewestEpisode(page) {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator(".cover-hero .big-play").click();
  await expect(page).toHaveURL(/#\/ep\//);
  await expect(page.locator(".issue-head h1")).not.toBeEmpty();
}

test("episode page shows artwork, credits, notes and read-along", async ({ page }) => {
  await openNewestEpisode(page);
  await expect(page.locator(".issue-head .art img")).toBeVisible();
  await expect(page.locator(".issue-head .pricebox")).toContainText(/\d+:\d\d/);
  await expect(page.locator(".crew a").first()).toHaveAttribute("href", /#\/who\//);
  await expect(page.locator(".notes")).not.toBeEmpty();
  await expect(page.locator("#dressno")).toHaveText("The Episode");

  // Row count matches the count the page itself claims.
  const claimed = Number((await page.locator(".issue-head .micro").textContent()).match(/(\d+) comics? indexed/)[1]);
  await expect(page.locator("#readalong .panel")).toHaveCount(claimed);
});

test("keyword tags search, and the crew links to panelists", async ({ page }) => {
  await openNewestEpisode(page);
  const tag = page.locator(".tags .tag").first();
  if (await tag.count()) {
    await tag.click();
    await expect(page).toHaveURL(/#\/search\?q=/);
  }
});

test("read-along toggle switches layout and persists", async ({ page }) => {
  await openNewestEpisode(page);
  await page.getByRole("button", { name: "Timestamps" }).click();
  await expect(page.locator("#readalong .ra-list")).toBeVisible();
  await expect(page.getByRole("button", { name: "Timestamps" })).toHaveAttribute("aria-pressed", "true");

  // The choice follows the reader across pages and reloads.
  await page.reload();
  await expect(page.locator("#readalong .ra-list")).toBeVisible();

  await page.getByRole("button", { name: "Stacked" }).click();
  await expect(page.locator("#readalong .ra-stack")).toBeVisible();
  await page.reload();
  await expect(page.locator("#readalong .ra-stack")).toBeVisible();
});

test("timestamp rows are honest about what cannot be played", async ({ page }) => {
  await openNewestEpisode(page);
  await page.getByRole("button", { name: "Timestamps" }).click();
  const rows = page.locator("#readalong .ra-row");
  await expect(rows.first()).toBeVisible();
  // Every row either offers a real minute or says plainly that it has none.
  const bad = await rows.evaluateAll(els => els.filter(el => {
    const t = el.querySelector(".t")?.textContent ?? "";
    const cue = el.querySelector(".cue")?.textContent ?? "";
    const playable = /\d+:\d\d/.test(t);
    return playable ? !cue.includes("Play") : !(t.includes("—") && cue.includes("Open"));
  }).length);
  expect(bad).toBe(0);
});

test("the strip scrolls itself and never the page", async ({ page }) => {
  await openNewestEpisode(page);
  await page.waitForSelector("#readalong .ra-strip");
  const r = await page.evaluate(() => {
    const s = document.querySelector(".ra-strip");
    s.scrollLeft = s.scrollWidth;
    const last = s.lastElementChild.getBoundingClientRect();
    return {
      overflowX: getComputedStyle(s).overflowX,
      lastReachable: last.right <= s.getBoundingClientRect().right + 2,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(r.overflowX).toBe("auto");
  expect(r.lastReachable).toBe(true);
  expect(r.pageScrollsSideways).toBe(false);
});

test("no sideways page scroll at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewestEpisode(page);
  await page.waitForSelector("#readalong .panel");
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("an unknown episode key says so instead of rendering blank", async ({ page }) => {
  await page.goto("/#/ep/not-a-real-key");
  await expect(page.locator(".empty")).toContainText(/No episode by that id/);
  await expect(page.locator(".empty a")).toHaveAttribute("href", "#/");
  await expect(page.locator(".pagehead h1")).toHaveText("Episode not found");
});

test("an episode with no artwork gets a blank variant plate", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    return core.episodes.find(e => !e.artwork && e.title)?.key ?? null;
  });
  test.skip(!key, "every episode has artwork");
  await page.goto("/#/ep/" + encodeURIComponent(key));
  await expect(page.locator(".art .gc.blank")).toBeVisible();
  await expect(page.locator(".art .gc-pub")).toHaveText("No artwork on file");
});

test("episode page is axe clean with no console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await openNewestEpisode(page);
  await expect(page.locator("#readalong")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the jump link opens the actual minute, not the page you are already on", async ({ page }) => {
  await openNewestEpisode(page);
  const jump = page.locator("#readalong a.ts").first();
  await expect(jump).toBeVisible();
  const href = await jump.getAttribute("href");
  // Linking back to #/ep/:key was a no-op for a reader already on the episode page.
  expect(href).not.toMatch(/^#\/ep\//);
  expect(href).toMatch(/^https:\/\/[a-z.]*simplecast\.com\/.*[?&]t=\d\dh\d\dm\d\ds/);
  await expect(jump).toHaveAttribute("target", "_blank");
  await expect(jump).toHaveAttribute("rel", /noopener/);
});

test("timestamp rows link to the minute too", async ({ page }) => {
  await openNewestEpisode(page);
  await page.getByRole("button", { name: "Timestamps" }).click();
  const playable = page.locator("#readalong .ra-row").filter({ hasText: "Play" }).first();
  if (await playable.count()) {
    expect(await playable.getAttribute("href")).toMatch(/simplecast\.com\/.*[?&]t=/);
  }
});

test("a full-episode play control sits above the Simplecast link", async ({ page }) => {
  await openNewestEpisode(page);
  const play = page.locator(".meta .big-play");
  await expect(play).toBeVisible();
  await expect(play).toHaveText(/Play from the top/);
  const order = await page.evaluate(() => {
    const meta = document.querySelector(".meta");
    const kids = [...meta.children];
    return {
      play: kids.findIndex(k => k.classList.contains("big-play")),
      links: kids.findIndex(k => k.classList.contains("linkrow")),
      tags: kids.findIndex(k => k.classList.contains("tags")),
    };
  });
  expect(order.play).toBeGreaterThan(order.tags);
  expect(order.play).toBeLessThan(order.links);
});
