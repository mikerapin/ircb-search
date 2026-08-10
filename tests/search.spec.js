import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { stubAudio } from "./fake-audio.js";

// Facets are links, not buttons — the URL is the only state, so every control is navigable
// and shareable. That also means aria-current, not aria-pressed.

/* A result is an episode. `.epcard` is the card; the matched comics inside it are `.rawrap`
   rows, and a playable one carries `.panel` too — so `.sec.mentions .panel` matches both the
   card and its own rows, and anything counting results has to say `.epcard`. */
const headline = async page => {
  const t = await page.locator(".honest-count").innerText();
  return {
    mentions: Number(t.match(/^([\d,]+) mention/)[1].replace(/,/g, "")),
    episodes: Number(t.match(/ in ([\d,]+) episode/)[1].replace(/,/g, "")),
  };
};

test("search url state round-trips", async ({ page }) => {
  await page.goto("/#/search?q=batman&sort=recent");
  await expect(page.locator(".sec.mentions .epcard").first()).toBeVisible();
  await expect(page.locator(".honest-count"))
    .toContainText(/[\d,]+ mentions? in [\d,]+ episodes?\. [\d,]+ of them you can jump straight into/);
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
  // The cap counts episodes now, so the line it prints has to as well.
  await page.goto("/#/search?q=batman");
  /* `.count()` is the one locator call that does not retry, and the view paints only after
     three chunks land. Without this wait the count is 0 under a loaded runner while
     `headline()` — which auto-waits — reads the real figures, so the test fails claiming the
     page showed a number it never showed. Every other count() in the suite waits first. */
  await page.waitForSelector(".sec.mentions .epcard");
  const shown = await page.locator(".sec.mentions .epcard").count();
  const { mentions, episodes } = await headline(page);
  expect(shown).toBeLessThanOrEqual(36);
  expect(shown).toBe(Math.min(36, episodes));
  // The header counts every matched episode. Reporting the number of cards instead would
  // read as an honest total and be short by 74 on this query.
  expect(episodes).toBeGreaterThan(shown);
  if (episodes > 36) {
    await expect(page.locator(".sec.mentions .lead"))
      .toContainText(new RegExp(`Showing 36 of ${episodes.toLocaleString("en-US")} episodes`));
  }
  // The regroup must not have quietly turned the mention total into a card count.
  expect(mentions).toBeGreaterThan(episodes);
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

test("a matched comic carries a jump or an honest refusal, and the data decides which", async ({ page }) => {
  // "exactly one control" was true whether the row offered a real jump or a dead refusal, so
  // it proved nothing about house rule 4. Decide each row against the data instead.
  await page.goto("/#/search?q=saga");
  await page.waitForSelector(".sec.mentions .epcard");

  const seen = await page.locator(".sec.mentions .epcard .rawrap[data-comic]").count();
  expect(seen, "no comic rows to judge").toBeGreaterThan(0);

  const bad = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    const byKey = new Map(core.episodes.map(e => [e.key, e]));
    const wrong = [];
    for (const row of document.querySelectorAll(".sec.mentions .epcard .rawrap[data-comic]")) {
      const ep = byKey.get(row.dataset.ep);
      const secs = row.dataset.secs === "" ? null : Number(row.dataset.secs);
      // jumpable(): a minute, audio on file, and a stamp inside the runtime.
      const canJump = secs != null && secs > 0 && !!ep?.enclosure
        && (ep.runtimeSecs == null || secs < ep.runtimeSecs);
      const live = row.querySelector("button.ra-row[data-act='cut']");
      const dead = row.querySelector("a.ra-row");
      if (canJump && !live) wrong.push(`${row.dataset.comic}: jumpable but no play control`);
      if (!canJump && !dead) wrong.push(`${row.dataset.comic}: not jumpable but offered a jump`);
      if (live && dead) wrong.push(`${row.dataset.comic}: both`);
    }
    return wrong;
  });
  expect(bad).toEqual([]);
});

/* ---------- episode-led results (Plan 3, Task 2) ----------
   Mike, on the review shots: a page of BATMAN plates reads as one result repeated, when it is
   really 75 different comics and the destination was always the episode. */

test("a result is an episode, and every matched comic is still on its card", async ({ page }) => {
  // Sweet Tooth sits under both caps — 21 episodes and no card over three comics — so the
  // page can be checked against the header exactly rather than approximately.
  await page.goto("/#/search?q=sweet%20tooth");
  await page.waitForSelector(".sec.mentions .epcard");
  const { mentions, episodes } = await headline(page);
  expect(episodes, "query outgrew the cap; the exact checks below stop holding").toBeLessThan(36);
  expect(mentions, "nothing collapsed, so this proves nothing").toBeGreaterThan(episodes);

  const cards = page.locator(".sec.mentions .epcard");
  await expect(cards).toHaveCount(episodes);
  const keys = await cards.evaluateAll(els => els.map(e => e.dataset.ep));
  expect(new Set(keys).size, "an episode was carded twice").toBe(keys.length);

  // Grouping must not lose a mention: under the row cap every matched comic still has a row.
  await expect(page.locator(".sec.mentions .epcard .rawrap[data-comic]")).toHaveCount(mentions);

  // The card states its date once, at the top. The read-along repeats it under every comic
  // because there the container never said it; here that would be the same line 23 times.
  const meta = await page.locator(".sec.mentions .epcard .ra-row .mt").allInnerTexts();
  expect(meta.filter(t => /\b(19|20)\d{2}\b/.test(t))).toEqual([]);
});

test("an episode carded for its comics is not repeated as a title match", async ({ page }) => {
  await page.goto("/#/search?q=saga");
  await page.waitForSelector(".sec.mentions .epcard");
  const above = await page.locator(".sec.mentions .epcard").evaluateAll(e => e.map(x => x.dataset.ep));
  const below = await page.locator(".sec.episodes .panel").evaluateAll(e => e.map(x => x.dataset.ep));
  expect(above.length).toBeGreaterThan(0);
  expect(below.length, "nothing in the lower section to collide with").toBeGreaterThan(0);
  expect(below.filter(k => above.includes(k))).toEqual([]);
});

test("a card stops at six comics and says how many it held back", async ({ page }) => {
  /* Only a junk query reaches the cap — the busiest real one is x-men at seven — so this
     uses "a", where one episode matches forty-four comics and an uncapped card would be
     taller than the screen. */
  await page.goto("/#/search?q=a");
  await page.waitForSelector(".sec.mentions .epcard");
  const cards = await page.locator(".sec.mentions .epcard").evaluateAll(els => els.map(el => ({
    ep: el.dataset.ep,
    rows: el.querySelectorAll(".rawrap[data-comic]").length,
    more: el.querySelector(".ra-row.more")?.textContent ?? null,
    href: el.querySelector(".ra-row.more")?.getAttribute("href") ?? null,
  })));
  expect(cards.length).toBeGreaterThan(0);
  for (const c of cards) expect(c.rows, `card ${c.ep}`).toBeLessThanOrEqual(6);

  const capped = cards.filter(c => c.more);
  expect(capped.length, "no card hit the cap — this query is too narrow to test it").toBeGreaterThan(0);
  for (const c of capped) {
    expect(c.rows).toBe(6);
    expect(c.more).toMatch(/^\+[\d,]+more match/);
    expect(c.href, "the overflow has to lead somewhere the rest can be read").toContain(encodeURIComponent(c.ep));
  }
});

test("a matched comic plays inside its own card", async ({ page }) => {
  await stubAudio(page);
  await page.goto("/#/search?q=batman");
  const row = page.locator(".sec.mentions .epcard .rawrap.panel button.ra-row[data-act=cut]").first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);
  // The player opens in the row that was clicked, not somewhere else on the page.
  await expect(page.locator(".sec.mentions .rawrap.playing .player")).toHaveCount(1);
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
