import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Real classes from the prototype: .issue-head / .art / .meta / .crew / .notes / .tags,
// and .togg / .ra-list / .ra-row for the read-along.

async function openNewestEpisode(page) {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator(".cover-hero .big-play").click();
  await expect(page).toHaveURL(/#\/ep\//);
  await expect(page.locator(".issue-head h1")).not.toBeEmpty();
}

test("episode page shows artwork, credits, notes and read-along", async ({ page }) => {
  await openNewestEpisode(page);
  await expect(page.locator(".issue-head .art img")).toBeVisible();
  await expect(page.locator(".issue-head .pricebox")).toContainText(/\d+:\d\d/);
  await expect(page.locator(".crew a").first()).toHaveAttribute("href", /#\/who\//);
  await expect(page.locator(".notes")).not.toBeEmpty();
  await expect(page.locator("#dressno")).toHaveText("The Episode");

  // Row count matches the count the page itself claims, now stated in the hero colophon.
  // /i because .artcap is text-transform:uppercase and innerText returns rendered text.
  const colo = await page.locator(".colo").innerText();
  const claimed = Number(colo.match(/(\d+) indexed/i)[1]);
  await expect(page.locator("#readalong .panel")).toHaveCount(claimed);

  /* The colophon states "N playable" only when some comics cannot be played — saying
     "7 indexed · 7 playable" repeats itself. Either way it must match the read-along. */
  const m = colo.match(/(\d+) playable/i);
  const jumpable = m ? Number(m[1]) : claimed;
  if (m) expect(jumpable).toBeLessThan(claimed);
  await expect(page.locator("#readalong .ts:not(.dead)")).toHaveCount(jumpable);
});

test("keyword tags search, and the crew links to panelists", async ({ page }) => {
  /* Was `if (await tag.count())` around every assertion, run against whatever the newest
     feed episode happens to be — and 292 of the 798 records carry no keywords, so episode.ts
     renders no .tags block at all and a normal week could switch the whole test off. Pick an
     episode that has them, and fail rather than skip if the archive somehow has none. */
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async () => {
    // detail.json is an array of {key, summary, keywords}, not a map.
    const det = await fetch("d/detail.json").then(r => r.json());
    return det.find(d => (d?.keywords ?? []).length > 0)?.key ?? null;
  });
  expect(key, "no episode in detail.json carries keywords").not.toBeNull();

  await page.goto("/#/ep/" + encodeURIComponent(key));
  await expect(page.locator(".issue-head h1")).not.toBeEmpty();

  /* The crew clause of this test's own name, which was only ever asserted as an href
     pattern in the first test. Follow it: the name is not compared, because ALIASES folds
     short spellings onto a different display name than the one in the URL. */
  const crew = page.locator(".crew a").first();
  await expect(crew).toHaveAttribute("href", /#\/who\//);
  await crew.click();
  await expect(page).toHaveURL(/#\/who\//);
  await expect(page.locator(".credit-head h1")).not.toBeEmpty();

  await page.goBack();
  const tag = page.locator(".tags .tag").first();
  await expect(tag).toBeVisible();
  const label = (await tag.innerText()).trim();
  await tag.click();
  await expect(page).toHaveURL(/#\/search\?q=/);
  await expect(page.locator("#q")).toHaveValue(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("read-along toggle switches layout and persists", async ({ page }) => {
  await openNewestEpisode(page);
  await page.getByRole("button", { name: "Timestamps" }).click();
  await expect(page.locator("#readalong .ra-list")).toBeVisible();
  await expect(page.getByRole("button", { name: "Timestamps" })).toHaveAttribute("aria-pressed", "true");

  // The choice follows the reader across pages and reloads.
  await page.reload();
  await expect(page.locator("#readalong .ra-list")).toBeVisible();

  await page.getByRole("button", { name: "Stacked" }).click();
  await expect(page.locator("#readalong .ra-stack")).toBeVisible();
  await page.reload();
  await expect(page.locator("#readalong .ra-stack")).toBeVisible();
});

test("timestamp rows are honest about what cannot be played", async ({ page }) => {
  await openNewestEpisode(page);
  await page.getByRole("button", { name: "Timestamps" }).click();
  const rows = page.locator("#readalong .ra-row");
  await expect(rows.first()).toBeVisible();
  // Every row either offers a real minute or says plainly that it has none.
  const bad = await rows.evaluateAll(els => els.filter(el => {
    const t = el.querySelector(".t")?.textContent ?? "";
    const cue = el.querySelector(".cue")?.textContent ?? "";
    const playable = /\d+:\d\d/.test(t);
    return playable ? !cue.includes("Play") : !(t.includes("—") && cue.includes("Open"));
  }).length);
  expect(bad).toBe(0);
});

test("the strip scrolls itself and never the page", async ({ page }) => {
  await openNewestEpisode(page);
  await page.waitForSelector("#readalong .ra-strip");
  const r = await page.evaluate(() => {
    const s = document.querySelector(".ra-strip");
    s.scrollLeft = s.scrollWidth;
    const last = s.lastElementChild.getBoundingClientRect();
    return {
      overflowX: getComputedStyle(s).overflowX,
      lastReachable: last.right <= s.getBoundingClientRect().right + 2,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(r.overflowX).toBe("auto");
  expect(r.lastReachable).toBe(true);
  expect(r.pageScrollsSideways).toBe(false);
});

test("no sideways page scroll at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewestEpisode(page);
  await page.waitForSelector("#readalong .panel");
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("an unknown episode key says so instead of rendering blank", async ({ page }) => {
  await page.goto("/#/ep/not-a-real-key");
  await expect(page.locator(".empty")).toContainText(/No episode by that id/);
  await expect(page.locator(".empty a")).toHaveAttribute("href", "#/");
  await expect(page.locator(".pagehead h1")).toHaveText("Episode not found");
});

test("an episode with no artwork gets a blank variant plate", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    return core.episodes.find(e => !e.artwork && e.title)?.key ?? null;
  });
  test.skip(!key, "every episode has artwork");
  await page.goto("/#/ep/" + encodeURIComponent(key));
  await expect(page.locator(".art .gc.blank")).toBeVisible();
  await expect(page.locator(".art .gc-pub")).toHaveText("No artwork on file");
});

test("episode page is axe clean with no console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await openNewestEpisode(page);
  await expect(page.locator("#readalong")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the jump control plays in the page, not off to another site", async ({ page }) => {
  await openNewestEpisode(page);
  const jump = page.locator("#readalong button.ts[data-act=cut]").first();
  await expect(jump).toBeVisible();
  // It used to be a link back to the page you were already on, then a link off to Simplecast.
  expect(await jump.getAttribute("data-secs")).toMatch(/^\d+$/);
  expect(await jump.getAttribute("href")).toBeNull();
});

/* "timestamp rows play in place too" lived here and asserted only that the row it found
   carries a numeric data-secs — which readalong.ts:45 guarantees for every element the
   locator can match, so the assertion was entailed by its own selector and the row was
   never clicked. It now lives in audio.spec.js as "a timestamp row plays in place", where
   the media stub makes clicking it safe: no spec in this file may click a play control,
   because a real enclosure request is a counted download (see fake-audio.js). */

test("the page leads with in-page playback, not with the off-site link", async ({ page }) => {
  await openNewestEpisode(page);
  const play = page.locator(".meta .big-play");
  await expect(play).toBeVisible();
  await expect(play).toHaveText(/Play from the top/);

  // The play control is the last thing in the reading column, after the notes and tags.
  const order = await page.evaluate(() => {
    const kids = [...document.querySelector(".meta").children];
    return {
      play: kids.findIndex(k => k.classList.contains("big-play")),
      tags: kids.findIndex(k => k.classList.contains("tags")),
    };
  });
  expect(order.play).toBeGreaterThan(order.tags);

  // Simplecast is a source credit in the hero colophon, not a call to action in the column.
  await expect(page.locator(".meta a[href*='simplecast']")).toHaveCount(0);
  await expect(page.locator(".colo a[href*='simplecast']")).toHaveCount(1);
});

test("the read-along really is in broadcast order", async ({ page }) => {
  await openNewestEpisode(page);
  const rows = await page.locator("#readalong .panel").evaluateAll(els =>
    els.map(p => (p.dataset.secs === "" ? null : Number(p.dataset.secs))));
  expect(rows.length).toBeGreaterThan(0);

  // Timestamped rows ascend, and every un-logged one sits after all of them — `secs ?? 0`
  // used to collapse them to zero and lead the list under a "broadcast order" heading.
  const stamped = rows.filter(s => s != null);
  expect(stamped).toEqual([...stamped].sort((a, b) => a - b));
  const firstNull = rows.indexOf(null);
  if (firstNull !== -1) expect(rows.slice(firstNull).every(s => s == null)).toBe(true);
});

test("a read-along row with no logged minute refuses honestly", async ({ page }) => {
  // 2,941 of 4,857 mentions carry no minute, but every episode test ran on the newest
  // episode, whose rows are all playable — so this branch was never rendered once.
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async () => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json()),
      fetch("d/mentions.json").then(r => r.json()),
    ]);
    const byKey = new Map(core.episodes.map(e => [e.key, e]));
    const byEp = new Map();
    for (const m of men) {
      if (!byEp.has(m.epKey)) byEp.set(m.epKey, []);
      byEp.get(m.epKey).push(m);
    }
    // An episode that has audio and mixes logged and unlogged minutes.
    for (const [k, list] of byEp) {
      const e = byKey.get(k);
      if (e?.enclosure && list.some(m => m.secs == null) && list.some(m => m.secs != null)) return k;
    }
    return null;
  });
  test.skip(!key, "no episode mixes logged and unlogged minutes");

  await page.goto("/#/ep/" + encodeURIComponent(key));
  await page.getByRole("button", { name: "Timestamps" }).click();
  await page.waitForSelector("#readalong .ra-row");

  const rows = await page.locator("#readalong .rawrap").evaluateAll(els => els.map(el => ({
    playable: !!el.querySelector("button.ra-row[data-act=cut]"),
    stamp: el.querySelector(".t")?.textContent ?? "",
    cue: el.querySelector(".cue")?.textContent ?? "",
    href: el.querySelector("a.ra-row")?.getAttribute("href") ?? null,
  })));
  const dead = rows.filter(r => !r.playable);
  expect(dead.length).toBeGreaterThan(0);
  for (const r of dead) {
    expect(r.stamp).toContain("—");          // no invented timestamp
    expect(r.cue).toContain("Open");         // and no play cue it cannot honour
    expect(r.href).toMatch(/^#\/ep\//);      // links to the episode, never off-site
  }
  // ...and the playable ones really are buttons, not links.
  for (const r of rows.filter(r => r.playable)) expect(r.stamp).toMatch(/\d+:\d\d/);
});
