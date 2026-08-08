import { test, expect } from "@playwright/test";

// .rail has several .rb blocks; the tenure figures live in the one headed "Tenure".
const tenureBox = page => page.locator(".railbox", { hasText: "Tenure" }).locator(".rb");

test("panelist page shows a real hero, tenure and co-panelists", async ({ page }) => {
  await page.goto("/#/who/Kara%20Szamborski");
  await expect(page.locator(".credit-head h1")).toHaveText("Kara Szamborski");
  await expect(page.locator("#dressno")).toHaveText("Credits");
  await expect(page.locator(".credit-head .por img")).toHaveAttribute("src", /avatars\//);
  await expect(page.locator(".tagline")).not.toBeEmpty();

  // Every figure traces to the data.
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json()));
  const real = core.episodes.filter(e => e.people.includes("Kara Szamborski")).length;
  await expect(page.locator(".statline")).toContainText(`${real.toLocaleString("en-US")} episode`);
  await expect(page.locator(".statline")).toContainText(`of all ${core.stats.episodes.toLocaleString("en-US")}`);

  await expect(page.locator(".rail .tenure .yr").first()).toBeVisible();
  await expect(page.locator(".panelgrid .pblock").first()).toHaveAttribute("href", /#\/who\//);
  await expect(page.locator(".panelgrid .pblock .st").first()).toHaveText(/\d+(\.\d)?% · [\d,]+ eps? together/);
});

test("active years never claims more than the show has run", async ({ page }) => {
  await page.goto("/#/who/Mike%20Rapin");
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json()));
  const showYears = new Set(core.episodes.filter(e => e.date).map(e => e.date.slice(0, 4))).size;
  // The prototype hardcoded "of 12"; this has to track however long the show has run.
  await expect(tenureBox(page)).toContainText(`of ${showYears}`);
  const active = Number((await tenureBox(page).textContent()).match(/(\d+) of \d+/)[1]);
  expect(active).toBeGreaterThan(0);
  expect(active).toBeLessThanOrEqual(showYears);
});

test("Danny and Daniel Martinez are one person", async ({ page }) => {
  await page.goto("/#/who/Danny%20Martinez");
  await expect(page.locator(".credit-head h1")).toHaveText("Daniel Martinez");
  const viaAlias = await page.locator(".statline").textContent();
  await page.goto("/#/who/Daniel%20Martinez");
  await expect(page.locator(".statline")).toHaveText(viaAlias);
});

test("a one-episode guest loses the wall and reads in the singular", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const name = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    const count = new Map();
    for (const e of core.episodes) for (const p of e.people) count.set(p, (count.get(p) || 0) + 1);
    return [...count].find(([, n]) => n === 1)?.[0] ?? null;
  });
  test.skip(!name, "everyone has more than one episode");
  await page.goto("/#/who/" + encodeURIComponent(name));
  await expect(page.locator(".statline")).toContainText("1 episode ");
  await expect(page.locator(".statline")).not.toContainText("1 episodes");
  await expect(page.locator(".sfx")).toHaveText("1 episode");
  // One episode is one square; a whole grid for that is noise.
  await expect(page.locator("details.acc")).toHaveCount(0);
});

test("a guest without a roster entry says so instead of showing a blank portrait", async ({ page }) => {
  await page.goto("/");
  // The roster is the home panel grid — wait for it, or every name looks like a guest.
  await page.waitForSelector(".panelgrid .pblock .nm");
  const name = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    const count = new Map();
    for (const e of core.episodes) for (const p of e.people) count.set(p, (count.get(p) || 0) + 1);
    const roster = new Set([...document.querySelectorAll(".panelgrid .pblock")]
      .map(a => decodeURIComponent(a.getAttribute("href").replace("#/who/", ""))));
    return [...count].sort((a, b) => b[1] - a[1]).find(([n, c]) => c > 2 && !roster.has(n))?.[0] ?? null;
  });
  test.skip(!name, "no frequent guest found");
  await page.goto("/#/who/" + encodeURIComponent(name));
  await expect(page.locator(".credit-head .micro")).toHaveText("Guest credits");
  await expect(page.locator(".railbox", { hasText: "Guest record" })).toBeVisible();
  await expect(page.locator(".tagline")).toHaveCount(0);
});

test("an unknown name says so", async ({ page }) => {
  await page.goto("/#/who/Nobody%20At%20All");
  await expect(page.locator(".empty")).toContainText(/No one by that name in the index/);
  await expect(page.locator(".pagehead h1")).toHaveText("Nobody At All");
});

test("the search filter chip carries the panelist through", async ({ page }) => {
  await page.goto("/#/who/Mike%20Rapin");
  const chip = page.locator(".rail .chip").first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/#\/search\?.*who=Mike\+Rapin/);
  await expect(page.locator(".honest-count")).toContainText("filtered to Mike Rapin");
});
