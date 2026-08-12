import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Plan 2 exit checks 3–6, run across the whole route list rather than on whichever pages
 * someone remembered to check. Add new routes to routeList() as they land.
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

function routeList({ ep, undated }) {
  return [
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
    ["index", "/#/index"],
    ["panelist", "/#/who/Kara%20Szamborski"],
    ["panelist alias", "/#/who/Danny%20Martinez"],
    ["panelist missing", "/#/who/Nobody%20At%20All"],
    ["panel", "/#/panel"],
    ["about", "/#/about"],
    ["subscribe", "/#/subscribe"],
    ["wall placeholder", "/#/wall"],
  ];
}

/**
 * body[data-ready] is stamped at src/main.ts:124, *before* core() is called on line 126, and
 * every view renders inside core().then(...). So it says the handlers are wired and nothing
 * about #view. With only a fixed 250 ms behind it, an unpainted #view — which is axe-clean,
 * holds no <a> and contributes no text — made all three sweeps below report success. Wait
 * for the view to actually paint, and fail loudly if it never does.
 */
async function gotoRoute(page, path) {
  await page.goto(path);
  await page.waitForSelector("body[data-ready]");
  await page.waitForFunction(
    () => (document.getElementById("view")?.innerText ?? "").trim().length > 0,
    null, { timeout: 15000 });
}

async function axeSweep(page, routes) {
  const failures = [];
  for (const [name, path] of routes) {
    await gotoRoute(page, path);
    const r = await new AxeBuilder({ page }).analyze();
    if (r.violations.length) {
      // The selector matters more than the count — "color-contrast(x61)" alone sends you
      // hunting through 61 nodes for one bad rule.
      failures.push(`${name}: ` + r.violations.map(v =>
        `${v.id}(x${v.nodes.length} @ ${v.nodes[0]?.target.join(" ")})`).join(", "));
    }
  }
  return failures;
}

test("every route is axe clean and free of console errors", async ({ page }) => {
  /* Genuinely long: axe analyses 19 routes, twice over for the two plates. ~15s on this
     machine and past the 30s default on a GitHub runner, where both of these timed out the
     first time CI actually ran the e2e suite. Slow because of what it covers, not because
     anything is wrong — say so rather than raising the default for every test. */
  test.slow();
  const routes = routeList(await sampleKeys(page));
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  expect(await axeSweep(page, routes)).toEqual([]);
  expect(errors).toEqual([]);
});

test("every route is axe clean on the negative plate too", async ({ page }) => {
  /* Genuinely long: axe analyses 19 routes, twice over for the two plates. ~15s on this
     machine and past the 30s default on a GitHub runner, where both of these timed out the
     first time CI actually ran the e2e suite. Slow because of what it covers, not because
     anything is wrong — say so rather than raising the default for every test. */
  test.slow();
  const routes = routeList(await sampleKeys(page));
  // The inline <head> script reads this before first paint, so every navigation below
  // renders dark from the start rather than flipping after the axe run.
  await page.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-neg", "");
  expect(await axeSweep(page, routes)).toEqual([]);
});

test("no route renders a dead link", async ({ page }) => {
  const routes = routeList(await sampleKeys(page)).map(([, path]) => path);
  const dead = [];
  for (const path of routes) {
    await gotoRoute(page, path);
    dead.push(...await page.evaluate(p => [...document.querySelectorAll("#view a")]
      .map(a => a.getAttribute("href"))
      .filter(h => !h || h === "#" || h.includes("undefined") || h.includes("null"))
      .map(h => `${p} → ${h}`), path));
  }
  expect(dead).toEqual([]);
});

test("no route leaks pre-launch process language", async ({ page }) => {
  const routes = routeList(await sampleKeys(page)).map(([, path]) => path);
  const leaks = [];
  for (const path of routes) {
    await gotoRoute(page, path);
    const text = await page.evaluate(() => document.body.innerText);
    /* No bare "pitch": the Index prints every series heading and one of them is a
       comic called Pitch. The terms here are ones our own copy would use and a comic
       title would not. */
    const m = text.match(/showcase series|prototype|round [12]\b|data cut|design test|sample data/i);
    if (m) leaks.push(`${path} → "${m[0]}"`);
  }
  expect(leaks).toEqual([]);
});
/* Exit check 5 (honest counts) is deliberately not a page scan: 527 is a stale prototype
   figure in one place and Danny Martinez's real mention count in another, and no regex
   tells them apart. Each view's own spec asserts its figures against core.json instead —
   about.spec (all six stats), panel.spec (roster + guests = people), index.spec (rows =
   series), home.spec (the Statement tiles). */

test("production is indexable — nothing tells a crawler to go away", async ({ page }) => {
  /* The prototype was served link-only from Cloudflare Pages behind a deny-all robots.txt,
     a `noindex` meta and an X-Robots-Tag. None of that ever lived in this repo — it is in
     the pitch-hosting folder — but shipping any of it here would quietly delist a site that
     is supposed to be found, and nothing else would notice. */
  const res = await page.request.get("/robots.txt");
  if (res.ok()) {
    const body = await res.text();
    // A robots.txt is fine; one that disallows the whole site is not.
    expect(body, "robots.txt disallows the site").not.toMatch(/^\s*Disallow:\s*\/\s*$/im);
  }
  expect(res.headers()["x-robots-tag"] ?? "").not.toMatch(/noindex/i);

  const routes = routeList(await sampleKeys(page)).map(([, path]) => path);
  const blocked = [];
  for (const path of routes) {
    await gotoRoute(page, path);
    const robots = await page.evaluate(() =>
      [...document.querySelectorAll('meta[name="robots"], meta[name="googlebot"]')]
        .map(m => m.getAttribute("content") ?? "").join(" "));
    if (/noindex|nofollow|none/i.test(robots)) blocked.push(`${path} → "${robots}"`);
  }
  expect(blocked).toEqual([]);
});
