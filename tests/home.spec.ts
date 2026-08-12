import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { CoreData } from "../src/data/types";

// The prototype names these .cover-hero / .panels > .panel — the plan's .hero/.plate
// were approximations, and the prototype's markup is the authority.

test("home shows hero and recent episodes from real data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cover-hero .pricebox")).toContainText(/\d+:\d\d/);
  await expect(page.locator(".hero-title")).not.toBeEmpty();
  const panels = page.locator(".panels .panel");
  await expect(panels).toHaveCount(8);
  await panels.first().locator("a.ts").click();
  await expect(page).toHaveURL(/#\/ep\//);
});

test("hero links to a real episode and counts are honest", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".hero-side .micro")).toContainText(/EP\. \d+ · \w{3} \d+, \d{4} · \d+ comics? indexed/);
  await expect(page.locator(".sfx")).toContainText(/[\d,]+ comics!/);
  await page.locator(".big-play").click();
  await expect(page).toHaveURL(/#\/ep\//);
});

test("statement of circulation matches the data exactly", async ({ page }) => {
  await page.goto("/");
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
  const tiles = page.locator(".stats .st");
  await expect(tiles).toHaveCount(4);
  const nf = (n: number) => n.toLocaleString("en-US");
  await expect(tiles.nth(0).locator(".n")).toHaveText(nf(core.stats.episodes));
  await expect(tiles.nth(1).locator(".n")).toHaveText(nf(core.stats.mentions));
  await expect(tiles.nth(2).locator(".n")).toHaveText(nf(core.stats.series));
  await expect(tiles.nth(3).locator(".n")).toHaveText(nf(core.stats.people));
});

test("panel grid shows 13 regulars with real percentages", async ({ page }) => {
  await page.goto("/");
  const blocks = page.locator(".panelgrid .pblock");
  await expect(blocks).toHaveCount(13);
  await expect(blocks.first().locator(".st")).toHaveText(/\d[\d,]* eps? · \d+%/);
  await expect(blocks.first()).toHaveAttribute("href", /#\/who\//);
  // Avatars are the self-hosted copies, not a third-party CDN.
  await expect(blocks.first().locator("img")).toHaveAttribute("src", /avatars\//);
});

test("patreon house ad lists the bonus runs with real collection links", async ({ page }) => {
  await page.goto("/");
  const slots = page.locator(".housead .adslot");
  await expect(slots.first()).toBeVisible();
  /* Against core.patreonSeries, not against itself. Both the header count and the grid come
     from the same runs.length in blocks.ts, so reading n off the rendered slots and then
     comparing it to the rendered header could only ever detect a mismatch it also caused.
     tests/subscribe.spec.js already anchors on the data this way. */
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
  const n = core.patreonSeries.length;
  expect(n).toBeGreaterThan(0);
  await expect(slots).toHaveCount(n);
  for (const href of await slots.evaluateAll(els => els.map(a => a.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/(www\.)?patreon\.com\//);
  }
  await expect(page.locator(".housead .hh .s")).toContainText(`${n} runs`);

  /* The ad quotes episode counts now, and they are the whole reason the section is worth
     more than a list of names. Anchor them on the data too: the header total is every
     Patreon-only episode, and each slot carries its own run's size. */
  const total = core.episodes.filter(e => e.key.startsWith("p:")).length;
  expect(total).toBeGreaterThan(n);
  await expect(page.locator(".housead .hh .s")).toContainText(`${total} episodes`);

  const shown = await slots.locator(".go").evaluateAll(els =>
    els.map(e => Number(e.textContent.replace(/[^0-9]/g, ""))));
  expect(shown).toEqual(core.patreonSeries.map(s => s.episodes));
  expect(shown.every(v => v > 0)).toBe(true);
});

test("coupon carries the locked wording", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".coupon")).toContainText(
    "New episode every Wednesday since 2015. Three people, a stack of comics, one hour — all catalogued in this index.");
});

test("rack and shuffle hydrate after first paint", async ({ page }) => {
  await page.goto("/");
  // Both need the mention list, so they arrive in a second pass.
  await expect(page.locator(".rack .slot")).toHaveCount(18);
  await expect(page.locator(".rack .slot").first()).toHaveAttribute("href", /#\/series\//);
  await expect(page.locator(".rack .slot .cnt").first()).toHaveText(/[\d,]+ mentions?/);
  await expect(page.locator(".threeup .sh")).toHaveCount(3);
});

/* Reading only `el.firstChild` covered one text node per plate. cover.ts inserts a <wbr>
   after every "/", so on the 49 headings that contain one, everything past the first slash
   lives in a later text node the scan never reached. Walk them all — and run the same scan
   on a route that renders mention plates, since the rack is a handful of series and the same
   generated plates appear on every search result and read-along panel. */
async function midWordBreaks(page: Page, selector: string) {
  await page.evaluate(() => document.fonts.ready);
  return page.locator(selector).evaluateAll(els => {
    const bad = [];
    for (const el of els) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const text = node.textContent || "";
        for (const m of text.matchAll(/\S+/g)) {
          const r = document.createRange();
          r.setStart(node, m.index);
          r.setEnd(node, m.index + m[0].length);
          // "FANTASTI / C FOUR" is two lines and two words, so counting lines proves
          // nothing. A word split across lines yields more than one rect for its own range.
          if (r.getClientRects().length > 1) bad.push({ plate: el.textContent, word: m[0] });
        }
      }
    }
    return bad;
  });
}

test("generated plate titles never break mid-word", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".rack .slot");
  expect(await midWordBreaks(page, ".rack .gc-t")).toEqual([]);

  /* The rack is eighteen series. Search used to be the second sweep, but a search result is
     an episode card now and carries no plate. The read-along still does, so the widest set of
     generated titles is the busiest episodes' own comic lists — 144 distinct titles across
     these three, four of them with a slash, against the 36 the search sweep reached. */
  const keys = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
    return core.episodes.slice()
      .sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 3).map(e => e.key);
  });
  expect(keys).toHaveLength(3);
  for (const key of keys) {
    await page.goto("/#/ep/" + encodeURIComponent(key));
    await page.waitForSelector("#readalong .gc-t");
    expect(await midWordBreaks(page, "#readalong .gc-t"), key).toEqual([]);
  }
});

test("first paint fetches core.json only", async ({ page }) => {
  const data: string[] = [];
  page.on("request", r => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/d/")) data.push(u.pathname);
  });
  await page.goto("/");
  // The hero and Recent Episodes render off core.json. The Rack and Shuffle need the
  // mention list, which is fetched in a second pass — allowed, as long as it never
  // gates the paint. Asserting "not yet requested" here would race that second pass.
  await expect(page.locator(".panels .panel")).toHaveCount(8);
  await expect(page.locator(".cover-hero .hero-title")).not.toBeEmpty();
  expect(data[0]).toBe("/d/core.json");

  await expect(page.locator(".rack .slot").first()).toBeVisible();
  // Summaries and keywords stay nobody's business until a search happens.
  expect(data).not.toContain("/d/detail.json");
  expect(new Set(data)).toEqual(new Set(["/d/core.json", "/d/mentions.json"]));
});

test("home is axe clean with no console errors", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/");
  await expect(page.locator(".cover-hero")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the hero wears the show's own episode number, not a count of anything", async ({ page }) => {
  // This test used to compute its expectation as `feed.length` — the same way the code did —
  // so it passed for two years while the hero read EP. 568 for an episode the show calls 525.
  // A number derived the same way as the thing under test cannot check it. The number now
  // comes from the episode record, and the two counts it must NOT equal are asserted by name.
  await page.goto("/");
  await page.waitForSelector(".cover-hero");
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
  const feed = core.episodes.filter(e => e.showId && e.date)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const newest = feed[feed.length - 1]!;

  expect(newest.ep).toBeGreaterThan(0);
  const micro = await page.locator(".hero-side .micro").innerText();
  expect(micro).toContain(`EP. ${newest.ep}`);
  // Neither the record count (950) nor the feed-item count (568) is an episode number.
  expect(newest.ep).toBeLessThan(feed.length);
  expect(micro).not.toContain(String(core.stats.episodes));
  expect(micro).not.toContain(`EP. ${feed.length}`);
  await expect(page.locator("#dressno")).toHaveText(`EP. ${newest.ep!.toLocaleString("en-US")}`);
  expect(newest.key).toBe(await page.locator(".hero-title a").getAttribute("href")
    .then(h => decodeURIComponent((h ?? "").replace("#/ep/", ""))));
});

test("nothing inside an episode panel escapes its own border", async ({ page }) => {
  // .epw used a 1fr track, which keeps a min-content floor, so the artwork's intrinsic
  // width pushed the track — and the runtime badge with it — past the panel's border.
  for (const route of ["/", "/#/who/Mike%20Rapin", "/#/search?q=batman"]) {
    await page.goto(route);
    await page.waitForSelector(".panel");
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40));
      }
    });
    await page.waitForTimeout(600);
    const escaped = await page.evaluate(() => {
      const out = [];
      for (const panel of document.querySelectorAll<HTMLElement>(".panel")) {
        const pb = panel.getBoundingClientRect();
        for (const el of panel.querySelectorAll<HTMLElement>("*")) {
          const b = el.getBoundingClientRect();
          if (!b.width) continue;
          const over = Math.max(b.right - pb.right, b.bottom - pb.bottom, pb.left - b.left, pb.top - b.top);
          if (over > 1) out.push(`${el.className || el.tagName} +${Math.round(over)}px`);
        }
      }
      return [...new Set(out)];
    });
    expect(escaped, `overflow on ${route}`).toEqual([]);
  }
});

test("every homepage section keeps its air", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".rack");
  await page.evaluate(async () => {
    for (let y = 0; y < 8000; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
  });
  await page.waitForTimeout(800);
  // The Shuffle and the Spinner Rack are injected into wrapper divs, which made their
  // lone section :last-child and zeroed the bottom margin — the next heading sat flush.
  const gaps = await page.evaluate(() => {
    const headOf = (t: string) => [...document.querySelectorAll<HTMLElement>(".sec-head")].find(h => h.textContent?.includes(t));
    const gap = (sel: string, t: string) => {
      const a = document.querySelector(sel), h = headOf(t);
      return a && h ? Math.round(h.getBoundingClientRect().top - a.getBoundingClientRect().bottom) : null;
    };
    return {
      shuffle: gap(".threeup", "Statement of Circulation"),
      stats: gap(".stats", "Spinner Rack"),
      rack: gap(".rack", "The Panel"),
      panel: gap(".panelgrid", "Recent Episodes"),
    };
  });
  for (const [where, px] of Object.entries(gaps)) {
    expect(px, `gap below ${where}`).not.toBeNull();
    expect(px, `gap below ${where}`).toBeGreaterThanOrEqual(40);
  }
});
