import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { EpisodeCore, CoreData } from "../src/data/types";

// .rail has several .rb blocks; the tenure figures live in the one headed "Tenure".
const tenureBox = (page: Page) => page.locator(".railbox", { hasText: "Tenure" }).locator(".rb");

test("panelist page shows a real hero, tenure and co-panelists", async ({ page }) => {
  await page.goto("/#/who/Kara%20Szamborski");
  await expect(page.locator(".credit-head h1")).toHaveText("Kara Szamborski");
  await expect(page.locator("#dressno")).toHaveText("Credits");
  await expect(page.locator(".credit-head .por img")).toHaveAttribute("src", /avatars\//);
  await expect(page.locator(".tagline")).not.toBeEmpty();

  // Every figure traces to the data.
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
  const real = core.episodes.filter(e => e.people.includes("Kara Szamborski")).length;
  await expect(page.locator(".statline")).toContainText(`${real.toLocaleString("en-US")} episode`);
  await expect(page.locator(".statline")).toContainText(`of all ${core.stats.episodes.toLocaleString("en-US")}`);

  await expect(page.locator(".rail .tenure .yr").first()).toBeVisible();
  await expect(page.locator(".panelgrid .pblock").first()).toHaveAttribute("href", /#\/who\//);
  await expect(page.locator(".panelgrid .pblock .st").first()).toHaveText(/\d+(\.\d)?% · [\d,]+ eps? together/);
});

test("active years never claims more than the show has run", async ({ page }) => {
  await page.goto("/#/who/Mike%20Rapin");
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
  const showYears = new Set(core.episodes.filter(e => e.date).map(e => e.date!.slice(0, 4))).size;
  // The prototype hardcoded "of 12"; this has to track however long the show has run.
  await expect(tenureBox(page)).toContainText(`of ${showYears}`);
  const active = Number(((await tenureBox(page).textContent()) ?? "").match(/(\d+) of \d+/)?.[1] ?? "0");
  expect(active).toBeGreaterThan(0);
  expect(active).toBeLessThanOrEqual(showYears);
});

test("Danny and Daniel Martinez are one person", async ({ page }) => {
  await page.goto("/#/who/Danny%20Martinez");
  await expect(page.locator(".credit-head h1")).toHaveText("Daniel Martinez");
  const viaAlias = await page.locator(".statline").textContent();
  await page.goto("/#/who/Daniel%20Martinez");
  await expect(page.locator(".statline")).toHaveText(viaAlias ?? "");
});

test("a one-episode guest loses the wall and reads in the singular", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const name = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
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
    const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
    const count = new Map();
    for (const e of core.episodes) for (const p of e.people) count.set(p, (count.get(p) || 0) + 1);
    const roster = new Set([...document.querySelectorAll<HTMLElement>(".panelgrid .pblock")]
      .map(a => decodeURIComponent((a.getAttribute("href") ?? "").replace("#/who/", ""))));
    return [...count].sort((a, b) => b[1] - a[1]).find(([n, c]) => c > 2 && !roster.has(n))?.[0] ?? null;
  });
  test.skip(!name, "no frequent guest found");
  await page.goto("/#/who/" + encodeURIComponent(name));
  await expect(page.locator(".credit-head .micro")).toHaveText("Guest credits");
  await expect(page.locator(".railbox", { hasText: "Guest record" })).toBeVisible();
  await expect(page.locator(".tagline")).toHaveCount(0);
});

/* The fold. Narrow, everything that is not the episode list collapses behind one summary so
   the episodes lead; wide, the <details> dissolves to display:contents and its children take
   the two columns they had before it existed. Both halves are asserted on geometry rather
   than on classes, because display:contents failing silently would leave the markup correct
   and the page wrong. */
test.describe("the supporting material folds on a narrow screen", () => {
  test("narrow: it is shut, and the episodes come first", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/who/Mike%20Rapin");
    await page.waitForSelector("body[data-ready]");

    const btn = page.locator("#foldbtn");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("aria-expanded", "false");

    /* The fold leads, but shut it is one bar, so it costs the episodes almost nothing — that
       is what lets it sit up here rather than at the bottom. Measured against the fold, not
       against the viewport: the hero is ~590px tall at this width and is what actually
       decides whether the episodes clear the fold line. */
    const more = (await page.locator(".more").boundingBox())!;
    const ep = (await page.locator(".mainpane").boundingBox())!;
    expect(more.height).toBeLessThan(70);
    expect(ep.y).toBeGreaterThan(more.y);
    expect(ep.y - more.y).toBeLessThan(120);

    // Real air between the bar and what follows it — this was 0 when the fold ran last.
    expect(ep.y - (more.y + more.height)).toBeGreaterThanOrEqual(20);

    // Shut means shut — the tenure strip and the co-panelist grid are off the page.
    await expect(page.locator(".rail .tenure")).toBeHidden();
    await expect(page.locator(".extras .panelgrid")).toBeHidden();

    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".rail .tenure")).toBeVisible();
  });

  test("narrow: the newest episodes come before the full list, and nothing runs flush", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/who/Mike%20Rapin");
    await page.waitForSelector("body[data-ready]");

    // A sample, then the whole run — "every episode" answers what the recent block raises.
    const panel = (await page.locator(".mainpane .panels").boundingBox())!;
    const every = (await page.locator(".mainpane details.acc").boundingBox())!;
    expect(every.y).toBeGreaterThan(panel.y);

    /* And the page cannot end flush again. The coupon used to butt straight up against the
       last block because the gap came from that block's own margin. */
    const last = (await page.locator(".whopage").boundingBox())!;
    const coupon = (await page.locator(".coupon").boundingBox())!;
    expect(coupon.y - (last.y + last.height)).toBeGreaterThanOrEqual(20);
  });

  test("wide: the fold dissolves back into two columns", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto("/#/who/Mike%20Rapin");
    await page.waitForSelector("body[data-ready]");

    await expect(page.locator("#foldbtn")).toBeHidden();
    await expect(page.locator(".rail .tenure")).toBeVisible();

    const rail = (await page.locator(".whopage .rail").boundingBox())!;
    const extras = (await page.locator(".whopage .extras").boundingBox())!;
    const main = (await page.locator(".whopage .mainpane").boundingBox())!;

    // Rail in the narrow left track, both others in the wide right one and aligned to it.
    expect(rail.width).toBeLessThan(300);
    expect(extras.x).toBeGreaterThan(rail.x + rail.width);
    expect(Math.abs(extras.x - main.x)).toBeLessThan(2);
    expect(main.width).toBeGreaterThan(rail.width * 2);
    // Context above the episode list, which is the order this page has always had.
    expect(extras.y).toBeLessThan(main.y);
  });

  test("crossing the breakpoint re-syncs it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/who/Mike%20Rapin");
    await page.waitForSelector("body[data-ready]");
    await expect(page.locator("#foldbtn")).toHaveAttribute("aria-expanded", "false");

    /* Resizing up must reopen it. The wide layout hides the button, so a fold left shut here
       would strand the rail and the extras with no control to reveal them. */
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.locator(".rail .tenure")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#foldbtn")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".rail .tenure")).toBeHidden();
  });

  test("navigating between people does not pile up listeners", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/who/Mike%20Rapin");
    await page.waitForSelector("body[data-ready]");
    for (const who of ["Kara%20Szamborski", "Mike%20Rapin", "Kara%20Szamborski"]) {
      await page.goto("/#/who/" + who);
      await expect(page.locator("#foldbtn")).toHaveAttribute("aria-expanded", "false");
    }
    // Still one live fold, and it still answers the breakpoint after four renders.
    await expect(page.locator("#foldbtn")).toHaveCount(1);
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.locator(".rail .tenure")).toBeVisible();
  });
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

test("an episode with no artwork still reserves its plate", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  // Someone whose recent episodes predate the artwork era, so the panels actually render.
  const name = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
    const by = new Map();
    for (const e of core.episodes) for (const p of e.people) {
      if (!by.has(p)) by.set(p, []);
      by.get(p).push(e);
    }
    return [...by].find(([, eps]) => (eps as EpisodeCore[]).filter(e => e.date).slice(0, 8).some(e => !e.artwork))?.[0] ?? null;
  });
  test.skip(!name, "every rendered episode carries artwork");

  await page.goto("/#/who/" + encodeURIComponent(name));
  await page.waitForSelector(".panels .epw-art");
  await page.waitForTimeout(400);
  const slots = await page.locator(".panels .epw-art").evaluateAll(els => els.map(a => ({
    img: !!a.querySelector<HTMLElement>("img"),
    h: a.getBoundingClientRect().height,
    w: a.getBoundingClientRect().width,
  })));
  const blanks = slots.filter(s => !s.img);
  expect(blanks.length).toBeGreaterThan(0);
  // It used to collapse to the 2px border. The slot is square whether or not art exists.
  for (const s of blanks) expect(s.h).toBeGreaterThan(s.w * 0.8);
  await expect(page.locator(".panels .epw-art .gc.blank").first()).toBeVisible();
});
