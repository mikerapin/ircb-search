import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json()));
  const tiles = page.locator(".stats .st");
  await expect(tiles).toHaveCount(4);
  const nf = n => n.toLocaleString("en-US");
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
  const n = await slots.count();
  expect(n).toBeGreaterThan(0);
  for (const href of await slots.evaluateAll(els => els.map(a => a.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/(www\.)?patreon\.com\//);
  }
  await expect(page.locator(".housead .hh .s")).toContainText(`${n} bonus series`);
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

test("generated plate titles never break mid-word", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".rack .slot");
  await page.evaluate(() => document.fonts.ready);
  // "FANTASTI / C FOUR" is two lines and two words, so counting lines proves nothing.
  // A word split across lines yields more than one client rect for its own range.
  const broken = await page.locator(".rack .gc-t").evaluateAll(els => {
    const bad = [];
    for (const el of els) {
      const node = el.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || "";
      for (const m of text.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        if (r.getClientRects().length > 1) bad.push({ plate: text, word: m[0] });
      }
    }
    return bad;
  });
  expect(broken).toEqual([]);
});

test("first paint fetches core.json only", async ({ page }) => {
  const data = [];
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
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/");
  await expect(page.locator(".cover-hero")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the hero wears a real feed number, not the record count", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".cover-hero");
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json()));
  const feed = core.episodes.filter(e => e.showId && e.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const newest = feed[feed.length - 1];

  const micro = await page.locator(".hero-side .micro").innerText();
  expect(micro).toContain(`EP. ${feed.length}`);
  // 230 of the 798 records were never numbered feed episodes, so the total must not appear.
  expect(feed.length).toBeLessThan(core.stats.episodes);
  expect(micro).not.toContain(String(core.stats.episodes));
  await expect(page.locator("#dressno")).toHaveText(`EP. ${feed.length.toLocaleString("en-US")}`);
  expect(newest.key).toBe(await page.locator(".hero-title a").getAttribute("href")
    .then(h => decodeURIComponent(h.replace("#/ep/", ""))));
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
      for (const panel of document.querySelectorAll(".panel")) {
        const pb = panel.getBoundingClientRect();
        for (const el of panel.querySelectorAll("*")) {
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
