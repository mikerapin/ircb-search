import { test, expect } from "@playwright/test";

/**
 * The four rules in these tests are stats-correctness requirements from Blubrry's published
 * player guidance (final-spec §9), not preferences. Breaking any of them misreports the
 * show's downloads, which is the show's business metric.
 */

async function openEpisode(page) {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator(".cover-hero .big-play").click();
  await page.waitForSelector("#readalong .panel");
}

test("a page visit downloads no audio", async ({ page }) => {
  const media = [];
  page.on("request", r => { if (/\.mp3|blubrry|podtrac/.test(r.url())) media.push(r.url()); });
  await openEpisode(page);
  await page.waitForTimeout(500);
  // preload="none" and no autoplay attribute: nothing is fetched until someone clicks.
  expect(media).toEqual([]);
  await expect(page.locator("#au")).toHaveAttribute("preload", "none");
  expect(await page.locator("#au").getAttribute("autoplay")).toBeNull();
});

test("jump plays in the page and seeks to the minute", async ({ page }) => {
  await openEpisode(page);
  const jump = page.locator("#readalong button.ts[data-act=cut]").first();
  const stamp = (await jump.textContent()).match(/(\d+):(\d\d)/);
  await jump.click();
  await page.waitForFunction(() => document.getElementById("au").readyState >= 1, null, { timeout: 20000 });
  await page.waitForTimeout(800);

  const s = await page.evaluate(() => {
    const au = document.getElementById("au");
    return { src: au.src, t: au.currentTime, inline: !!document.querySelector(".panel.playing .player") };
  });
  expect(s.src).toBeTruthy();
  expect(s.inline).toBe(true);                      // the player opened in the clicked panel
  const expected = Number(stamp[1]) * 60 + Number(stamp[2]);
  expect(Math.abs(s.t - expected)).toBeLessThan(5); // seeked to roughly the logged minute
});

test("the enclosure URL is never modified", async ({ page }) => {
  const media = [];
  page.on("request", r => { if (/blubrry|podtrac|\.mp3/.test(r.url())) media.push(r.url()); });
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await page.waitForFunction(() => document.getElementById("au").readyState >= 1, null, { timeout: 20000 });

  // Blubrry keys episode identity on the exact URL — a ?t= would split one episode in two.
  const src = await page.evaluate(() => document.getElementById("au").src);
  expect(src).not.toMatch(/[?&]t=/);
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json()));
  const ep = core.episodes.find(e => src.startsWith(e.enclosure));
  expect(ep, "audio src must be an unmodified enclosure from the feed").toBeTruthy();
  expect(src).toBe(ep.enclosure);
  expect(media.length).toBeGreaterThan(0);
});

test("playback survives navigation via the mini-bar", async ({ page }) => {
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await page.waitForFunction(() => !document.getElementById("au").paused, null, { timeout: 20000 });
  await expect(page.locator("#minibar")).not.toHaveClass(/\bon\b/);   // inline player is alive

  const before = await page.evaluate(() => document.getElementById("au").currentTime);
  await page.locator(".crumb a").click();                             // navigate away
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => ({
    playing: !document.getElementById("au").paused,
    t: document.getElementById("au").currentTime,
    label: document.getElementById("mb-cm").textContent,
  }));
  expect(after.playing).toBe(true);
  expect(after.t).toBeGreaterThan(before);
  await expect(page.locator("#minibar")).toHaveClass(/\bon\b/);
  expect(after.label.length).toBeGreaterThan(0);
});

test("the mini-bar can pause and close", async ({ page }) => {
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await page.waitForFunction(() => !document.getElementById("au").paused, null, { timeout: 20000 });
  await page.locator(".crumb a").click();
  await expect(page.locator("#minibar")).toHaveClass(/\bon\b/);

  await page.locator("#mb-pp").click();
  await expect.poll(() => page.evaluate(() => document.getElementById("au").paused)).toBe(true);

  await page.locator("#mb-x").click();
  await expect(page.locator("#minibar")).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => document.getElementById("au").getAttribute("src"))).toBeNull();
});

test("an episode with no audio still says so rather than offering a dead control", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async () => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json()),
      fetch("d/mentions.json").then(r => r.json()),
    ]);
    const withMentions = new Set(men.map(m => m.epKey));
    return core.episodes.find(e => !e.enclosure && withMentions.has(e.key))?.key ?? null;
  });
  test.skip(!key, "no un-enclosed episode carries mentions");
  await page.goto("/#/ep/" + encodeURIComponent(key));
  await page.waitForSelector("#readalong");
  expect(await page.locator("#readalong button[data-act=cut]").count()).toBe(0);
  await expect(page.locator("#readalong .ts.dead").first()).toContainText(/No audio on file|No minute logged/);
});

test("a segment stops at the next logged minute and hands over the player", async ({ page }) => {
  await openEpisode(page);
  const bounds = await page.evaluate(() =>
    [...document.querySelectorAll("#readalong .panel")].map(el => ({ secs: el.dataset.secs, until: el.dataset.until })));
  test.skip(bounds.length < 2 || !bounds[0].until, "episode has no second timestamp");
  // Each mention's segment ends where the next one starts.
  expect(Number(bounds[0].until)).toBe(Number(bounds[1].secs));

  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();
  await page.waitForFunction(() => !document.getElementById("au").paused, null, { timeout: 20000 });

  // Drop in just short of the boundary rather than waiting out the whole segment.
  await page.evaluate(() => {
    const el = document.querySelector("#readalong .panel");
    document.getElementById("au").currentTime = Number(el.dataset.until) - 3;
  });
  await page.waitForFunction(
    () => document.getElementById("au").paused &&
          [...document.querySelectorAll("#readalong .panel")].indexOf(document.querySelector("#readalong .panel.playing")) === 1,
    null, { timeout: 20000 });

  const s = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("#readalong .panel")];
    const playing = document.querySelector("#readalong .panel.playing");
    return {
      paused: document.getElementById("au").paused,
      index: panels.indexOf(playing),
      open: !!playing.querySelector(".player"),
      seeked: Math.round(document.getElementById("au").currentTime),
      expected: Number(playing.dataset.secs),
    };
  });
  expect(s.paused).toBe(true);                 // stopped, per the segment boundary
  expect(s.index).toBe(1);                     // player moved to the next timestamp
  expect(s.open).toBe(true);                   // ...and opened there
  expect(Math.abs(s.seeked - s.expected)).toBeLessThan(5);
});

test("the inline play/pause button tracks the audio state", async ({ page }) => {
  await openEpisode(page);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();
  await page.waitForFunction(() => !document.getElementById("au").paused, null, { timeout: 20000 });

  const pp = page.locator("#readalong .panel.playing .player .pp");
  await expect(pp).toHaveText("II");           // playing
  await pp.click();
  await expect(pp).toHaveText("▶");            // it used to freeze on "II" here
  await expect(pp).toHaveAttribute("aria-label", "Play");
  await expect(page.locator("#readalong .panel.playing .player .note")).toContainText("Paused");
  await pp.click();
  await expect(pp).toHaveText("II");
  await expect(pp).toHaveAttribute("aria-label", "Pause");
});
