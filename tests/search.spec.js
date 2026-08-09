import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Facets are links, not buttons — the URL is the only state, so every control is navigable
// and shareable. That also means aria-current, not aria-pressed.

test("search url state round-trips", async ({ page }) => {
  await page.goto("/#/search?q=batman&sort=recent");
  await expect(page.locator(".sec.mentions .panel").first()).toBeVisible();
  await expect(page.locator(".honest-count")).toContainText(/[\d,]+ mentions? in [\d,]+ episodes? — [\d,]+ you can jump to/);
  await page.locator(".rail .facet", { hasText: "Newest first" }).click();
  await expect(page).toHaveURL(/sort=recent/);
});

test("panelist facet filters and marks itself current", async ({ page }) => {
  await page.goto("/#/search?q=batman");
  const facet = page.locator('.railbox.who .facet[href*="who="]').first();
  const name = (await facet.textContent()).replace(/\d[\d,]*$/, "").trim();
  await facet.click();
  await expect(page).toHaveURL(/who=/);
  await expect(page.locator(".honest-count")).toContainText(`filtered to ${name}`);
  await expect(page.locator('.railbox.who .facet[aria-current="true"]')).toHaveCount(1);
});

test("the cap is honest about what it hides", async ({ page }) => {
  await page.goto("/#/search?q=batman");
  const shown = await page.locator(".sec.mentions .panel").count();
  const text = await page.locator(".honest-count").textContent();
  const total = Number(text.match(/^([\d,]+) mention/)[1].replace(/,/g, ""));
  expect(shown).toBeLessThanOrEqual(36);
  if (total > 36) await expect(page.locator(".sec.mentions .lead")).toContainText(/Showing 36 of [\d,]+/);
  expect(total).toBeGreaterThanOrEqual(shown);
});

test("empty query shows newest episodes", async ({ page }) => {
  await page.goto("/#/search");
  await expect(page.getByRole("heading", { name: /newest episodes/i })).toBeVisible();
  await expect(page.locator(".panels .panel")).toHaveCount(8);
});

test("a query with no matches says so instead of rendering nothing", async ({ page }) => {
  await page.goto("/#/search?q=zzzzqqqxxnotacomic");
  await expect(page.locator(".empty")).toContainText(/No panel for that/);
  await expect(page.locator(".chips .chip").first()).toBeVisible();
});

test("mention plates carry a jump or an honest refusal, and the data decides which", async ({ page }) => {
  // "exactly one .ts" was true whether the plate offered a real jump or a dead refusal, so
  // it proved nothing about house rule 4. Decide each plate against the data instead.
  await page.goto("/#/search?q=saga");
  await page.waitForSelector(".sec.mentions .panel");
  await expect(page.locator(".sec.mentions .panel .gc").first()).toBeVisible();

  const bad = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    const byKey = new Map(core.episodes.map(e => [e.key, e]));
    const wrong = [];
    for (const panel of document.querySelectorAll(".sec.mentions .panel")) {
      const ep = byKey.get(panel.dataset.ep);
      const secs = panel.dataset.secs === "" ? null : Number(panel.dataset.secs);
      // jumpable(): a minute, audio on file, and a stamp inside the runtime.
      const canJump = secs != null && secs > 0 && !!ep?.enclosure
        && (ep.runtimeSecs == null || secs < ep.runtimeSecs);
      const live = panel.querySelector("button.ts[data-act='cut']");
      const dead = panel.querySelector("a.ts.dead");
      if (canJump && !live) wrong.push(`${panel.dataset.comic}: jumpable but no play control`);
      if (!canJump && !dead) wrong.push(`${panel.dataset.comic}: not jumpable but offered a jump`);
      if (live && dead) wrong.push(`${panel.dataset.comic}: both`);
    }
    return wrong;
  });
  expect(bad).toEqual([]);
});

test("panelist avatars are self-hosted and actually load", async ({ page }) => {
  const foreign = [];
  page.on("request", r => {
    if (r.resourceType() !== "image") return;
    const h = new URL(r.url()).host;
    if (h !== new URL(page.url()).host) foreign.push(h);
  });
  await page.goto("/#/search?q=batman");
  const avatars = page.locator(".railbox.who .facet img");
  await expect(avatars.first()).toBeVisible();
  // Squarespace-hosted avatars would break silently if ircbpodcast.com were redesigned.
  expect(foreign.filter(h => h.includes("squarespace"))).toEqual([]);
  // They are lazy-loaded, so wait for decode rather than sampling mid-flight.
  await page.waitForFunction(
    () => [...document.querySelectorAll(".railbox.who .facet img")].every(i => i.complete),
    null, { timeout: 10000 });
  const broken = await avatars.evaluateAll(els => els.filter(i => i.naturalWidth === 0).map(i => i.src));
  expect(broken).toEqual([]);
});

test("search is axe clean with no console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/#/search?q=batman");
  await expect(page.locator(".rail")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("a facet count is what clicking that facet delivers, guest filter included", async ({ page }) => {
  // With guest=1 active, the rail used to show counts computed without it.
  await page.goto("/#/search?q=batman&guest=1");
  await page.waitForSelector(".railbox.who .facet");
  const rows = await page.locator(".railbox.who .facet").evaluateAll(els =>
    els.map(a => ({ href: a.getAttribute("href"), n: a.querySelector(".n")?.textContent }))
       .filter(r => r.n));
  expect(rows.length).toBeGreaterThan(0);

  for (const r of rows.slice(0, 3)) {
    await page.goto(r.href);
    await page.waitForSelector(".honest-count");
    const claimed = (await page.locator(".honest-count").innerText()).match(/^([\d,]+) mention/)[1];
    expect(claimed).toBe(r.n);
  }
});
