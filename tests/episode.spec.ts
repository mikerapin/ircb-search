import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { CoreData, EpisodeDetail, Mention } from "../src/data/types";

// Real classes from the prototype: .issue-head / .art / .meta / .crew / .notes / .tags,
// and .togg / .ra-list / .ra-row for the read-along.

async function openNewestEpisode(page: Page) {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator(".cover-hero .big-play").click();
  await expect(page).toHaveURL(/#\/ep\//);
  await expect(page.locator(".issue-head h1")).not.toBeEmpty();
}

test("episode page shows artwork, credits, notes and read-along", async ({ page }) => {
  await openNewestEpisode(page);
  await expect(page.locator(".issue-head .art img")).toBeVisible();
  // The colophon already carried Runtime while a badge said it again over the artwork.
  await expect(page.locator(".issue-head .colo")).toContainText(/\d+:\d\d/);
  await expect(page.locator(".issue-head .pricebox")).toHaveCount(0);
  await expect(page.locator(".crew a").first()).toHaveAttribute("href", /#\/who\//);
  await expect(page.locator(".notes")).not.toBeEmpty();
  await expect(page.locator("#dressno")).toHaveText("The Episode");

  // Row count matches the count the page itself claims, now stated in the hero colophon.
  // /i because .artcap is text-transform:uppercase and innerText returns rendered text.
  const colo = await page.locator(".colo").innerText();
  const claimed = Number(colo.match(/(\d+) indexed/i)?.[1] ?? "0");
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
     feed episode happens to be, and plenty of records carry no keywords at all, so episode.ts
     renders no .tags block at all and a normal week could switch the whole test off. Pick an
     episode that has them, and fail rather than skip if the archive somehow has none. */
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async () => {
    // detail.json is an array of {key, summary, keywords}, not a map.
    const det = await fetch("d/detail.json").then(r => r.json() as Promise<EpisodeDetail[]>);
    return det.find(d => (d?.keywords ?? []).length > 0)?.key ?? null;
  });
  expect(key, "no episode in detail.json carries keywords").not.toBeNull();

  await page.goto("/#/ep/" + encodeURIComponent(key ?? ""));
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
  const isShelved = await tag.getAttribute("href").then(h => /#\/series\//.test(h ?? ""));
  await tag.click();
  if (isShelved) {
    await expect(page).toHaveURL(/#\/series\//);
  } else {
    await expect(page).toHaveURL(/#\/search\?q=/);
    await expect(page.locator("#q")).toHaveValue(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

/**
 * A tag that names a book we shelve goes to the shelf; everything else runs a search. The
 * branch above follows whichever the newest tagged episode happens to carry, so it cannot
 * prove both exist — this picks one episode of each kind out of the data and follows it.
 *
 * The selection states the contract rather than re-implementing the view: an episode whose
 * keyword names a run the index holds should link there. It deliberately does not read
 * `keywordSeries`, which carries only the terms that spell something other than their own
 * heading, so a test built on it would miss the nine in ten that do.
 */
test("a tag that names a shelved book links to the shelf, not a search", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");

  const picks = await page.evaluate(async () => {
    const [det, men] = await Promise.all([
      fetch("d/detail.json").then(r => r.json() as Promise<EpisodeDetail[]>),
      fetch("d/mentions.json").then(r => r.json() as Promise<Mention[]>),
    ]);
    const shelvedBy = new Map<string, Set<string>>();
    for (const m of men) {
      let s = shelvedBy.get(m.epKey);
      if (!s) shelvedBy.set(m.epKey, (s = new Set()));
      s.add(m.series.toLowerCase());
    }
    let shelved = null, loose = null;
    for (const d of det) {
      const own = shelvedBy.get(d.key) ?? new Set<string>();
      for (const k of d.keywords ?? []) {
        const hit = own.has(k.trim().toLowerCase()) || !!d.keywordSeries?.[k];
        if (hit && !shelved) shelved = { key: d.key, tag: k };
        if (!hit && !loose) loose = { key: d.key, tag: k };
      }
      if (shelved && loose) break;
    }
    return { shelved, loose };
  });

  expect(picks.shelved, "no keyword anywhere names a run the index holds").not.toBeNull();
  expect(picks.loose, "every keyword names a run, which cannot be right").not.toBeNull();

  for (const [pick, pattern] of [
    [picks.shelved, /#\/series\//],
    [picks.loose, /#\/search\?q=/],
  ] as const) {
    await page.goto("/#/ep/" + encodeURIComponent(pick!.key));
    const chip = page.locator(".tags .tag", { hasText: new RegExp(`^\\s*${
      pick!.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i") }).first();
    await expect(chip).toHaveAttribute("href", pattern);
  }
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
  /* Every row either offers a real minute or says plainly that it has none — and on this
     page a row that has none offers nothing at all. It used to carry an "Open" cue pointing
     at the episode the reader was already on, so the link did nothing when clicked. */
  const bad = await rows.evaluateAll(els => els.filter(el => {
    const t = el.querySelector<HTMLElement>(".t")?.textContent ?? "";
    const cue = el.querySelector<HTMLElement>(".cue")?.textContent ?? "";
    const playable = /\d+:\d\d/.test(t);
    return playable ? !cue.includes("Play") : !(t.includes("—") && cue === "");
  }).length);
  expect(bad).toBe(0);
});

/**
 * The show notes stamp a segment once and then list what was discussed under it, so one minute
 * routinely carries a pile of books — 19 on the Superman episode, 47 on the worst, and about a
 * quarter of every stamped row in the archive sits in such a pile. A row each meant a screen of
 * identical timestamps offering identical jumps to the same second.
 *
 * The episode is chosen out of the data rather than pinned, so this keeps working as the
 * archive grows, and the expected count comes from the mention list rather than from the
 * markup — a count read off the page could only ever agree with whatever the page did.
 */
test("comics sharing a minute are one row, not one row each", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const pick = await page.evaluate(async () => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json() as Promise<CoreData>),
      fetch("d/mentions.json").then(r => r.json() as Promise<Mention[]>),
    ]);
    const withAudio = new Set(core.episodes.filter(e => e.enclosure).map(e => e.key));
    const byEp = new Map<string, Mention[]>();
    for (const m of men) {
      if (m.secs == null || !withAudio.has(m.epKey)) continue;
      if (!byEp.has(m.epKey)) byEp.set(m.epKey, []);
      byEp.get(m.epKey)!.push(m);
    }
    for (const [key, list] of byEp) {
      const tally = new Map<number, number>();
      for (const m of list) tally.set(m.secs!, (tally.get(m.secs!) ?? 0) + 1);
      const [secs, n] = [...tally].sort((a, b) => b[1] - a[1])[0]!;
      if (n >= 3) return { key, secs, n, stamps: tally.size };
    }
    return null;
  });
  expect(pick, "no episode stamps three comics at one minute").not.toBeNull();

  await page.goto("/#/ep/" + encodeURIComponent(pick!.key));
  await page.getByRole("button", { name: "Timestamps" }).click();
  await page.waitForSelector("#readalong .ra-row");

  // One row per distinct logged minute, not one per comic.
  const stamped = page.locator("#readalong .rawrap.panel");
  await expect(stamped).toHaveCount(pick!.stamps);

  // And the busiest of them carries every comic logged at that minute.
  const titles = await page.locator(`#readalong .rawrap[data-secs="${pick!.secs}"] .cm`).count();
  expect(titles).toBe(pick!.n);
});

test("the strip scrolls itself and never the page", async ({ page }) => {
  await openNewestEpisode(page);
  await page.waitForSelector("#readalong .ra-strip");
  const r = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".ra-strip");
    s!.scrollLeft = s!.scrollWidth;
    const last = s!.lastElementChild!.getBoundingClientRect();
    return {
      overflowX: getComputedStyle(s!).overflowX,
      lastReachable: last.right <= s!.getBoundingClientRect().right + 2,
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
    const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
    return core.episodes.find(e => !e.artwork && e.title)?.key ?? null;
  });
  test.skip(!key, "every episode has artwork");
  await page.goto("/#/ep/" + encodeURIComponent(key ?? ""));
  await expect(page.locator(".art .gc.blank")).toBeVisible();
  await expect(page.locator(".art .gc-pub")).toHaveText("No artwork on file");
});

test("episode page is axe clean with no console errors", async ({ page }) => {
  const errors: Error[] = [];
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
    const kids = [...document.querySelector<HTMLElement>(".meta")!.children];
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
  // Most mentions carry no minute, but every episode test ran on the newest
  // episode, whose rows are all playable — so this branch was never rendered once.
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async () => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json() as Promise<CoreData>),
      fetch("d/mentions.json").then(r => r.json() as Promise<Mention[]>),
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
      if (e?.enclosure && list.some((m: Mention) => m.secs == null) && list.some((m: Mention) => m.secs != null)) return k;
    }
    return null;
  });
  test.skip(!key, "no episode mixes logged and unlogged minutes");

  await page.goto("/#/ep/" + encodeURIComponent(key ?? ""));
  await page.getByRole("button", { name: "Timestamps" }).click();
  await page.waitForSelector("#readalong .ra-row");

  const rows = await page.locator("#readalong .rawrap").evaluateAll(els => els.map(el => ({
    playable: !!el.querySelector<HTMLElement>("button.ra-row[data-act=cut]"),
    stamp: el.querySelector<HTMLElement>(".t")?.textContent ?? "",
    cue: el.querySelector<HTMLElement>(".cue")?.textContent ?? "",
    href: el.querySelector<HTMLAnchorElement>("a.ra-row")?.getAttribute("href") ?? null,
  })));
  const dead = rows.filter(r => !r.playable);
  expect(dead.length).toBeGreaterThan(0);
  for (const r of dead) {
    expect(r.stamp).toContain("—");          // no invented timestamp
    expect(r.cue).toBe("");                  // and no cue it cannot honour
    /* Not a link either. On this episode's own read-along the only place an "Open" could
       point is the page already on screen, so the row stopped being an anchor rather than
       offering a click that does nothing. */
    expect(r.href).toBeNull();
  }
  // ...and the playable ones really are buttons, not links.
  for (const r of rows.filter(r => r.playable)) expect(r.stamp).toMatch(/\d+:\d\d/);
});
