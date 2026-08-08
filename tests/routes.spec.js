import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Plan 2 exit check 3: axe clean on every route, not on whichever pages someone remembered
 * to check. Add new routes here as they land rather than writing a fresh axe test per view.
 */

async function sampleKeys(page) {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  return page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    return {
      ep: core.episodes.find(e => e.artwork && e.enclosure)?.key,
      undated: core.episodes.find(e => !e.date)?.key,
    };
  });
}

test("every route is axe clean and free of console errors", async ({ page }) => {
  const { ep, undated } = await sampleKeys(page);
  const routes = [
    ["home", "/"],
    ["search", "/#/search?q=batman"],
    ["search empty", "/#/search"],
    ["search no hits", "/#/search?q=zzzqqxxnothing"],
    ["search filtered", "/#/search?q=batman&sort=recent&guest=1"],
    ["episode", "/#/ep/" + encodeURIComponent(ep)],
    ["episode undated", "/#/ep/" + encodeURIComponent(undated)],
    ["episode missing", "/#/ep/not-a-real-key"],
    ["series", "/#/series/Saga"],
    ["series long", "/#/series/Batman"],
    ["series missing", "/#/series/Not%20A%20Real%20Comic%20Xyzzy"],
  ];

  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));

  const failures = [];
  for (const [name, path] of routes) {
    await page.goto(path);
    await page.waitForSelector("body[data-ready]");
    await page.waitForTimeout(250);
    const r = await new AxeBuilder({ page }).analyze();
    if (r.violations.length) {
      failures.push(`${name}: ` + r.violations.map(v => `${v.id}(x${v.nodes.length})`).join(", "));
    }
  }
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

test("no route renders a dead link", async ({ page }) => {
  const { ep } = await sampleKeys(page);
  const routes = ["/", "/#/search?q=saga", "/#/ep/" + encodeURIComponent(ep), "/#/series/Saga"];
  const dead = [];
  for (const path of routes) {
    await page.goto(path);
    await page.waitForSelector("body[data-ready]");
    await page.waitForTimeout(250);
    dead.push(...await page.evaluate(p => [...document.querySelectorAll("#view a")]
      .map(a => a.getAttribute("href"))
      .filter(h => !h || h === "#" || h.includes("undefined") || h.includes("null"))
      .map(h => `${p} → ${h}`), path));
  }
  expect(dead).toEqual([]);
});

test("no route leaks pre-launch process language", async ({ page }) => {
  const { ep } = await sampleKeys(page);
  const routes = ["/", "/#/search?q=saga", "/#/ep/" + encodeURIComponent(ep), "/#/series/Saga"];
  const leaks = [];
  for (const path of routes) {
    await page.goto(path);
    await page.waitForSelector("body[data-ready]");
    await page.waitForTimeout(250);
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(/showcase series|prototype|pitch|round [12]\b|data cut|design test/i);
    if (m) leaks.push(`${path} → "${m[0]}"`);
  }
  expect(leaks).toEqual([]);
});
