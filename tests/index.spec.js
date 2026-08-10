import { test, expect } from "@playwright/test";

test("the index lists every series, A to Z", async ({ page }) => {
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json()));

  // Every heading is on the page — no silent truncation.
  await expect(page.locator(".azrow")).toHaveCount(core.stats.series);
  await expect(page.locator("#dressno")).toHaveText("The Index");
  await expect(page.locator(".statline")).toContainText(core.stats.series.toLocaleString("en-US"));

  // Bucket counts add up to the total.
  const bucketTotal = await page.locator(".azsec > h2 > span").evaluateAll(els =>
    els.reduce((n, e) => n + Number(e.textContent.replace(/,/g, "")), 0));
  expect(bucketTotal).toBe(core.stats.series);
});

test("the index renders from its own chunk, never the mention list", async ({ page }) => {
  const chunks = [];
  page.on("request", r => {
    const m = r.url().match(/\/d\/([\w.-]+)$/);
    if (m) chunks.push(m[1]);
  });
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  // Absence needs a settle, or a late fetch lands after the assertion and the test passes
  // for the wrong reason.
  await page.waitForLoadState("networkidle").catch(() => {});

  expect(chunks).toContain("index.json");
  // 574K raw / 90K gzipped, for a table that needs none of the fields on a mention. The
  // Index used to derive itself from it, and could paint nothing until it had all arrived.
  expect(chunks).not.toContain("mentions.json");
});

test("buckets are sorted and rows sorted within them", async ({ page }) => {
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  const letters = await page.locator(".azsec > h2").evaluateAll(els =>
    els.map(e => e.firstChild.textContent.trim()));
  expect(letters).toEqual([...letters].sort());

  const first = await page.locator(".azsec").first().locator(".azrow .nm").evaluateAll(els =>
    els.map(e => e.textContent));
  expect(first).toEqual([...first].sort((a, b) => a.localeCompare(b)));
});

test("a row opens its series page", async ({ page }) => {
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  const name = await page.locator(".azrow .nm").first().textContent();
  await page.locator(".azrow").first().click();
  await expect(page).toHaveURL(/#\/series\//);
  await expect(page.locator(".issue-head h1")).toHaveText(name);
});

test("the A-Z bar scrolls without hijacking the route", async ({ page }) => {
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  const before = page.url();
  await page.locator('.azbar [data-jump="az-S"]').click();
  // A fragment link here would navigate; these are buttons that scroll.
  expect(page.url()).toBe(before);
  // On screen is not enough: it used to land *behind* the sticky bar that triggered it.
  const r = await page.evaluate(() => {
    const h = document.getElementById("az-S");
    return {
      top: h.getBoundingClientRect().top,
      barBottom: document.querySelector(".azbar").getBoundingClientRect().bottom,
      vh: window.innerHeight,
      focused: document.activeElement?.id,
    };
  });
  expect(r.top).toBeLessThan(r.vh);
  expect(r.top).toBeGreaterThanOrEqual(r.barBottom - 2);
  // ...and the jump has to move focus, or it does nothing for keyboard users.
  expect(r.focused).toBe("az-S");
});

/* There was a "the index stays responsive at full size" test here, asserting
   `Date.now() - t0 < 4000` around a goto and `< 2000` around a click. It timed Playwright
   RPC and dev-server compilation on a machine running the other 100-odd tests in parallel,
   so it measured the runner, not the page — the last pure wall-clock assertion in the
   suite. Its real invariants are already covered without a clock: every row renders (the
   first test asserts .azrow count === stats.series) and a row opens its series page ("a row
   opens its series page"). Don't re-add it; put page-weight budgets in a perf project with
   its own worker if they're ever wanted. */
