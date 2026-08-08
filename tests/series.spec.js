import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("series page: hero, honest counts, checklist oldest first", async ({ page }) => {
  await page.goto("/#/series/Saga");
  await expect(page.locator(".issue-head h1")).toHaveText("Saga");
  await expect(page.locator("#dressno")).toHaveText("The Run");

  // The headline count and the checklist row count are the same number.
  const claimed = Number((await page.locator(".statline").textContent()).match(/^([\d,]+) mention/)[1].replace(/,/g, ""));
  await expect(page.locator(".checklist .clrow")).toHaveCount(claimed);
  await expect(page.locator(".checklist .hd .r")).toContainText(`${claimed} row`);

  // Oldest first.
  const years = await page.locator(".checklist .clrow .ep").evaluateAll(els =>
    els.map(e => (e.textContent.match(/\b(19|20)\d{2}\b/) || [])[0]).filter(Boolean).map(Number));
  expect(years).toEqual([...years].sort((a, b) => a - b));
});

test("checklist rows offer a jump or say plainly they have none", async ({ page }) => {
  await page.goto("/#/series/Batman");
  await expect(page.locator(".checklist .clrow").first()).toBeVisible();
  const bad = await page.locator(".checklist .clrow").evaluateAll(els => els.filter(el => {
    const ts = el.querySelector(".ts"), no = el.querySelector(".nomin");
    if (ts) return !/\d+:\d\d/.test(ts.textContent);          // a jump must show a real minute
    return !(no && /no minute logged|no audio/.test(no.textContent));
  }).length);
  expect(bad).toBe(0);
});

test("See Also separates works that share a name instead of folding them", async ({ page }) => {
  await page.goto("/#/series/Batman");
  const chips = page.locator(".chips .chip");
  await expect(chips.first()).toBeVisible();
  // "All-Star Batman" is its own work — it must be a chip, never a Batman checklist row.
  const names = await chips.evaluateAll(els => els.map(e => e.textContent));
  expect(names.some(n => /Batman/i.test(n))).toBe(true);
  const rowText = await page.locator(".checklist .clrow .cm").evaluateAll(els => els.map(e => e.textContent));
  expect(rowText.every(t => !/^All[- ]Star Batman/i.test(t))).toBe(true);
  await chips.first().click();
  await expect(page).toHaveURL(/#\/series\//);
});

test("a one-mention series reads in the singular", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const name = await page.evaluate(async () => {
    const men = await fetch("d/mentions.json").then(r => r.json());
    const count = new Map();
    for (const m of men) count.set(m.series, (count.get(m.series) || 0) + 1);
    return [...count].find(([, n]) => n === 1)?.[0] ?? null;
  });
  test.skip(!name, "no single-mention series");
  await page.goto("/#/series/" + encodeURIComponent(name));
  await expect(page.locator(".statline")).toContainText(/\b1 mention indexed/);
  await expect(page.locator(".statline")).not.toContainText("1 mentions");
  await expect(page.locator(".sfx")).toHaveText("1 mention");
  await expect(page.locator(".checklist .hd .r")).toHaveText("1 row");
});

test("an unknown heading says so instead of rendering an empty checklist", async ({ page }) => {
  await page.goto("/#/series/Not%20A%20Real%20Comic%20Xyzzy");
  await expect(page.locator(".empty")).toContainText(/Nothing in the index under that heading/);
});

test("no pre-launch process language on a series page", async ({ page }) => {
  await page.goto("/#/series/Saga");
  await expect(page.locator(".checklist")).toBeVisible();
  const text = await page.locator("#view").innerText();
  expect(text).not.toMatch(/showcase series|data cut|prototype|pitch/i);
});

test("series page is axe clean with no console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/#/series/Saga");
  await expect(page.locator(".checklist")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});
