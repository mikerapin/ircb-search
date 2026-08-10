import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The Wall is a calendar, so the thing worth asserting hardest is what is NOT on it: an
 * episode with no air date has no square, because there is nowhere honest to put it.
 */

const data = page => page.evaluate(() => fetch("d/core.json").then(r => r.json()));

test("a square for every dated episode, and none for the undated", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const core = await data(page);
  const dated = core.episodes.filter(e => e.date);

  await expect(page.locator(".cell")).toHaveCount(dated.length);
  expect(dated.length).toBeLessThan(core.stats.episodes);   // there really are undated ones

  // ...and the legend says how many are missing rather than leaving it to be noticed.
  await expect(page.locator(".walllegend")).toContainText(
    String(core.stats.episodes - dated.length));

  const keys = await page.locator(".cell").evaluateAll(els => els.map(e => e.dataset.cell));
  const undated = new Set(core.episodes.filter(e => !e.date).map(e => e.key));
  expect(keys.filter(k => undated.has(k))).toEqual([]);
});

test("the ink ramp actually varies with how many comics were logged", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const buckets = await page.locator(".cell").evaluateAll(els => {
    const out = {};
    for (const e of els) {
      const m = e.className.match(/\bn(\d)\b/);
      if (m) out[m[1]] = (out[m[1]] ?? 0) + 1;
    }
    return out;
  });
  // A ramp that collapsed to one bucket would still look like a wall and mean nothing.
  expect(Object.keys(buckets).length).toBeGreaterThan(2);

  // n0 is its own state: no comics logged, not "a few".
  const core = await data(page);
  const none = core.episodes.filter(e => e.date && !e.mentionCount).length;
  expect(buckets["0"] ?? 0).toBe(none);
});

test("years group in order and the counts on each row are real", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".yrow");
  const rows = await page.locator(".yrow").evaluateAll(els => els.map(el => ({
    year: el.querySelector(".ylab").firstChild.textContent.trim(),
    label: Number((el.querySelector(".cnt").textContent.match(/\d+/) ?? [0])[0]),
    cells: el.querySelectorAll(".cell").length,
  })));
  expect(rows.length).toBeGreaterThan(1);
  // Reverse chronological: newest year at the top.
  expect(rows.map(r => r.year)).toEqual([...rows.map(r => r.year)].sort().reverse());
  for (const r of rows) expect(r.label, `row ${r.year}`).toBe(r.cells);

  /* Only the stack of years reversed. Inside a row the run still reads left to right,
     oldest first — check it against the dates, not the rendering. */
  const keys = await page.locator(".yrow").first().locator(".cell").evaluateAll(els =>
    els.map(e => e.dataset.cell));
  const core = await data(page);
  const dateOf = new Map(core.episodes.map(e => [e.key, e.date]));
  const dates = keys.map(k => dateOf.get(k));
  expect(dates.length).toBeGreaterThan(1);
  expect(dates).toEqual([...dates].sort());
});

test("searching lights the wall instead of filtering it away", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");        // the rack means mentions have landed
  const total = await page.locator(".cell").count();

  await page.locator("#ignite").fill("batman");
  await expect(page.locator("#wall")).toHaveClass(/\blit\b/);
  const hits = await page.locator(".cell.hit").count();
  expect(hits).toBeGreaterThan(0);
  expect(hits).toBeLessThan(total);
  // Every square stays on the page — dimmed, not removed. That is the whole idea.
  await expect(page.locator(".cell")).toHaveCount(total);
  await expect(page.locator("#resline")).toContainText(String(hits));

  await page.locator("[data-act=wclear]").click();
  await expect(page.locator("#wall")).not.toHaveClass(/\blit\b/);
});

test("a rack chip's number is what clicking it actually lights", async ({ page }) => {
  /* The count used to be "episodes carrying that exact series", while the click ran a text
     search — so Saga's chip said 15 and lit 21, because "Saga" also matches "Saga:
     Compendium One". Same defect the search facets already have a test for. */
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");
  const chip = page.locator("#wrack .wchip").first();
  const claimed = Number((await chip.locator("b").innerText()).replace(/,/g, ""));
  await chip.click();
  await expect(page.locator("#wall")).toHaveClass(/\blit\b/);
  expect(await page.locator(".cell.hit").count()).toBe(claimed);
});

test("a panelist filter needs no comic data and marks itself pressed", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const face = page.locator(".ribbon .pface").first();
  const who = await face.getAttribute("data-who");
  await face.click();
  await expect(face).toHaveAttribute("aria-pressed", "true");

  const hits = await page.locator(".cell.hit").count();
  const core = await data(page);
  // Panel membership lives in core.json, so this must work whether or not mentions loaded.
  const expected = core.episodes.filter(e => e.date && e.people.includes(who)).length;
  expect(hits).toBe(expected);

  await face.click();
  await expect(face).toHaveAttribute("aria-pressed", "false");
});

test("a square opens the episode in the rail, and the rail closes cleanly", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");
  await page.locator(".cell").first().click();

  await expect(page.locator("#rail")).toBeVisible();
  await expect(page.locator("#railbody h2")).not.toBeEmpty();
  await expect(page.locator("#railbody a[href^='#/ep/']").first()).toBeVisible();

  /* The close button has to actually be clickable. `.pricebox` is position:absolute, and the
     rail rendered it with no positioned box to pin to, so it resolved against #rail and sat
     exactly on top of this button — every click bounced off the runtime badge. Only showed
     up once the newest year moved to the top, because the 2015 episodes it used to click
     carry no runtime and so rendered no badge at all. */
  await page.locator("#rail-x").click({ timeout: 5000 });
  await expect(page.locator("#rail")).toBeHidden();
  // Hiding a container that holds focus strands the reader on <body>.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("view");
});

test("?e= centres a square and fires the arrival cue once", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const key = await page.locator(".cell").nth(200).getAttribute("data-cell");

  await page.goto("/#/wall?e=" + encodeURIComponent(key));
  const cell = page.locator(`.cell[data-cell="${key}"]`);
  await expect(cell).toHaveClass(/\bcurrent\b/);
  // The swirl is one-time: it plays and removes itself, leaving the steady outline.
  await expect(cell).not.toHaveClass(/\bspot\b/, { timeout: 5000 });
  await expect(page.locator("#rail")).toBeVisible();
});

test("no sideways scroll at 390, and the phone grid is the 13-column one", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const cols = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".ycells")).gridTemplateColumns.split(" ").length);
  expect(cols).toBe(13);
});

test("the wall is axe clean on both plates with no console errors", async ({ page }) => {
  for (const neg of [false, true]) {
    const ctx = await page.context().newPage();
    if (neg) await ctx.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
    const errors = [];
    ctx.on("pageerror", e => errors.push(String(e)));
    await ctx.goto("/#/wall");
    await ctx.waitForSelector("#wrack .wchip");
    const axe = await new AxeBuilder({ page: ctx }).analyze();
    expect(axe.violations, neg ? "negative plate" : "light plate").toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
