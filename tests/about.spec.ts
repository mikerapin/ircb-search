import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CoreData, Mention } from "../src/data/types";

const nf = (n: number) => n.toLocaleString("en-US");

async function data(page: Page) {
  return page.evaluate(async () => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json() as Promise<CoreData>),
      fetch("d/mentions.json").then(r => r.json() as Promise<Mention[]>),
    ]);
    /* jumpable() re-implemented from its documented rule rather than imported, so a silent
       change to the rule in engine.ts shows up here as a failure instead of agreeing with
       itself. A minute alone is not enough: it needs audio and a stamp inside the runtime. */
    const byKey = new Map(core.episodes.map(e => [e.key, e]));
    const canJump = men.filter(m => {
      const e = byKey.get(m.epKey);
      return m.secs != null && m.secs > 0 && !!e?.enclosure && (e.runtimeSecs == null || m.secs < e.runtimeSecs);
    }).length;
    return { core, noMinute: men.filter(m => m.secs == null).length, mentions: men.length, canJump };
  });
}

test("about renders all five sections", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator("#dressno")).toHaveText("About the Data");
  await expect(page.locator(".pagehead h1")).toHaveText("About the Data");
  // Scoped to #view: the footer also carries a "Sources" heading.
  for (const h of ["Where All This Came From", "The Show Is Older Than The Feed",
    "What’s Missing", "Why The Comic Names Look Like That"]) {
    await expect(page.locator("#view").getByRole("heading", { name: h, exact: true })).toBeVisible();
  }
});

test("every figure on the page matches the data", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();
  const { core, noMinute, canJump } = await data(page);
  const s = core.stats;
  const text = await page.locator("#view").innerText();

  expect(text).toContain(nf(s.episodes));
  expect(text).toContain(nf(s.mentions));
  expect(text).toContain(nf(s.indexedEpisodes));
  expect(text).toContain(nf(s.series));
  expect(text).toContain(nf(s.uniqueComics));
  expect(text).toContain(nf(s.people));
  // The gaps are the point of the page — they have to be the real ones.
  expect(text).toContain(nf(core.episodes.filter(e => !e.date).length));
  expect(text).toContain(nf(noMinute));
  // The jumpable figure must be the jumpable count, not merely the with-a-minute count —
  // those differ, and the page is claiming what the play controls actually honour.
  //
  // The noun matters as much as the number. This read "N tags can be jumped into" for one
  // commit, and tagged mentions carry no minute by construction — 0 of 319 have one — so the
  // page was advertising 1,967 jumps into a set that offers none. Pin the whole clause.
  expect(text).toMatch(new RegExp(`${nf(canJump)} comic references can be jumped into`));
  expect(text).toContain(`${nf(s.indexedEpisodes)} episodes indexed`);
});

/* The three eras used to split on two different axes — `!showId && date` for the back
   catalogue, `patreonUrl` for the shelf — which double-counted the one dated Patreon record
   and orphaned the one record with no showId, no date and no Patreon URL. The two errors
   cancelled, so the numbers summed to 798 and looked verified. A sum alone would not have
   caught it; the per-bucket equalities would. */
test("the three eras partition the archive", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();
  const { core } = await data(page);
  const counts = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll<HTMLElement>("#view .kv > div")].flatMap(row => {
      const dt = row.querySelector<HTMLElement>("dt")?.textContent?.trim();
      const n = row.querySelector<HTMLElement>("dd")?.textContent?.trim().match(/^([\d,]+)/);
      return dt && n?.[1] ? [[dt, Number(n[1].replace(/,/g, ""))]] : [];
    })));

  const eps = core.episodes;
  expect(counts["In the feed"]).toBe(eps.filter(e => e.showId).length);
  expect(counts["Before the feed"]).toBe(eps.filter(e => !e.showId && !e.patreonUrl).length);
  expect(counts["The Patreon shelf"]).toBe(eps.filter(e => !e.showId && e.patreonUrl).length);
  expect((counts["In the feed"] ?? 0) + (counts["Before the feed"] ?? 0) + (counts["The Patreon shelf"] ?? 0))
    .toBe(core.stats.episodes);
  // Every record lands in exactly one bucket — the property the sum only implies.
  expect(eps.filter(e => [!!e.showId, !e.showId && !e.patreonUrl, !e.showId && !!e.patreonUrl]
    .filter(Boolean).length !== 1)).toEqual([]);
});

test("the sources block credits each source with what it actually supplies", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();
  const { core } = await data(page);
  const dd = await page.locator("#view .kv > div", { hasText: /^Episodes/ }).locator("dd").innerText();
  // The RSS feed carries only some of the records and supplies none of the titles, dates or
  // panel for the ones the spreadsheet already has — export_data.py takes those from the
  // spreadsheet and merges only summary, enclosure, artwork and duration off the feed. The
  // exception is an episode the spreadsheet has not reached yet, which comes wholly from the
  // feed until it does; see append_missing.
  expect(dd).toContain(nf(core.episodes.filter(e => e.showId).length));
  expect(dd).toMatch(/titles, air dates and who was on the panel for all [\d,]+ records/);
  expect(dd).not.toMatch(/feed[^.]*titles/i);
});

test("the sample-data claim is gone", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();
  const text = await page.locator("#view").innerText();
  // The prototype claimed "complete coverage for twelve showcase series" — true of the
  // pitch's sample cut, false here, and exactly the pre-launch language the spec forbids.
  expect(text).not.toMatch(/showcase series|twelve showcase|sample|prototype|pitch|round [12]\b/i);
  expect(text).toMatch(/every one of the [\d,]+ comics we\s+logged/i);
});

test("the published normalization rules describe what the code actually does", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();     // the view paints async
  const text = await page.locator("#view").innerText();
  // Folded: separators only.
  expect(text).toMatch(/Star Wars: Visions/);
  expect(text).toMatch(/Dead Dog’s Bite/);
  // Kept apart: a letter or a word of difference.
  expect(text).toMatch(/Monster.{0,40}Monsters/s);
  expect(text).toMatch(/chapter/i);          // manga chapters are stripped too

  // ...and the claims hold against the real index.
  const { core } = await page.evaluate(async () => ({ core: await fetch("d/core.json").then(r => r.json() as Promise<CoreData>) }));
  const men = await page.evaluate(() => fetch("d/mentions.json").then(r => r.json() as Promise<Mention[]>));
  const names = new Set(men.map(m => m.series));
  const folded = new Set(men.filter(m => /Star Wars.{0,3}Visions/i.test(m.comic)).map(m => m.series));
  if (folded.size) expect(folded.size).toBe(1);        // one run, not two
  // Was `expect(true).toBe(true)`. The page claims these are kept apart; prove it.
  expect(names.has("Monster")).toBe(true);
  expect(names.has("Monsters")).toBe(true);
  const runFor = (t: string) => [...new Set(men.filter(m => m.comic.trim().toLowerCase() === t).map(m => m.series))];
  expect(runFor("monster")).toEqual(["Monster"]);
  expect(runFor("monsters")).toEqual(["Monsters"]);
  expect(core.stats.uniqueComics).toBeGreaterThan(core.stats.series);
});

test("about is reachable from the shell and the index", async ({ page }) => {
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  await page.locator('.statline a[href="#/about"]').click();
  await expect(page).toHaveURL(/#\/about/);
  await expect(page.locator(".pagehead h1")).toHaveText("About the Data");
});
