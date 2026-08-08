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
  const onScreen = await page.evaluate(() => {
    const h = document.getElementById("az-S");
    const r = h.getBoundingClientRect();
    return r.top >= -2 && r.top < window.innerHeight;
  });
  expect(onScreen).toBe(true);
});

test("the index stays responsive at full size", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const t0 = Date.now();
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  // 3,000+ rows is the point of the page; this guards against a regression, not a target.
  expect(Date.now() - t0).toBeLessThan(4000);
  const t1 = Date.now();
  await page.locator(".azrow").first().click();
  await page.waitForURL(/#\/series\//);
  expect(Date.now() - t1).toBeLessThan(2000);
});
