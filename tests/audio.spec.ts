import { test, expect } from "@playwright/test";
import { stubAudio, FAKE_AUDIO_SECONDS, SILENT_WAV_URI } from "./fake-audio";
import type { Page } from "@playwright/test";
import type { CoreData } from "../src/data/types";

/**
 * The rules asserted here are stats-correctness requirements from Blubrry's published player
 * guidance (final-spec §9), not preferences. Breaking any of them misreports the show's
 * downloads, which is the show's business metric.
 *
 * Every test stubs the media: see fake-audio.js for why a suite that really streamed the
 * enclosure would corrupt the very numbers these tests exist to protect.
 */

async function openEpisode(page: Page) {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator(".cover-hero .big-play").click();
  await page.waitForSelector("#readalong .panel");
}

/**
 * Compress the first two segments so a boundary arrives in seconds instead of minutes, and
 * so the handover lands inside the stub's runtime. Mirrors how real data chains: one
 * mention's `until` is the next mention's `secs`.
 */
async function shortSegment(page: Page, lengthSecs = 4) {
  return page.evaluate(len => {
    const [first, second] = document.querySelectorAll<HTMLElement>("#readalong .panel");
    const restamp = (panel: HTMLElement, secs: number, until: number) => {
      panel.dataset.secs = String(secs);
      panel.dataset.until = String(until);
      // The click handler reads the button's own data-secs first, so it has to move too.
      const btn = panel.querySelector<HTMLElement>("[data-act=cut]");
      if (btn) btn.dataset.secs = String(secs);
    };
    restamp(first!, 2, 2 + len);
    if (second) restamp(second, 2 + len, 2 + len * 2);
    return { secs: 2, until: 2 + len };
  }, lengthSecs);
}

/**
 * Record where each seek actually landed, at the moment it landed.
 *
 * Asserting on `currentTime` after a fixed wait raced the running tape: the tolerance was
 * spent on elapsed wall-clock, so a loaded machine failed a correct seek. These values are
 * frozen when the `seeked` event fires, so the assertion is immune to how late it is read.
 */
async function recordSeeks(page: Page) {
  await page.evaluate(() => {
    const a = document.getElementById("au") as HTMLAudioElement;
    window.__seeks = [];
    a.addEventListener("seeked", () => window.__seeks!.push(a.currentTime));
  });
}

const seekLanded = (page: Page, want: number, tol = 1.5) =>
  page.waitForFunction(([w, t]) => (window.__seeks ?? []).some(s => Math.abs(s - w) < t),
    [want, tol] as [number, number], { timeout: 15000 });

/**
 * A canary, not a feature test — and the first thing to read when several specs below fail
 * together.
 *
 * Chromium on this machine lost its audio output mid-session once, and every spec that rides
 * the tape turned into an opaque 20-second timeout. Nothing pointed at the cause: `play()`
 * RESOLVED, `readyState` was 4, `au.error` was null, and `currentTime` simply never advanced.
 * It reproduced on a bare data: URI in a headed browser with none of this project loaded, and
 * it fixed itself later with no change to anything here. So: no app, no network, no engine —
 * if this one is red, the tape specs are telling you about the machine, not the code.
 */
test("the browser can actually play audio at all", async ({ page }) => {
  await page.setContent(`<audio id="canary" src="${SILENT_WAV_URI}"></audio>`);
  /* Poll rather than sleep once. A first cut slept 1.2s and demanded 0.2s of progress, which
     failed at 0.11 on a runner busy with the rest of the suite — audio was fine, the clock was
     just running slow under load. That is a different animal from the real failure, where it
     sits frozen with `paused` true however long you wait. Give slowness room; a dead audio
     stack still never moves. */
  const moved = await page.evaluate(async () => {
    const a = document.getElementById("canary") as HTMLAudioElement;
    try { await a.play(); } catch (e) { return `play() rejected: ${(e as Error).name}`; }
    const start = a.currentTime;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      if (a.currentTime > start + 0.5) return true;
    }
    return `the clock sat at ${a.currentTime.toFixed(3)} for 8s (paused=${a.paused})`;
  });
  expect(moved, "Chromium is not rendering audio — the tape specs below cannot pass").toBe(true);
});

test("a page visit downloads no audio", async ({ page }) => {
  const asked = await stubAudio(page);
  await openEpisode(page);
  // preload="none" and no autoplay attribute: nothing is fetched until someone clicks.
  await expect(page.locator("#au")).toHaveAttribute("preload", "none");
  expect(await page.locator("#au").getAttribute("autoplay")).toBeNull();

  /* The headline assertion used to be `expect(asked).toEqual([])` after a 500 ms wait, which
     held for any implementation: index.html ships <audio> with no src at all and engine.ts
     assigns one only inside jumpCut, so there was nothing to fetch regardless of preload.
     Point the element at a real enclosure and *then* assert nothing went out — that is the
     invariant preload="none" actually buys. A timeout is right here: the claim is that
     nothing happens, and there is no state to wait for. */
  const enclosure = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
    return core.episodes.find(e => e.enclosure)!.enclosure!;
  });
  await page.evaluate(u => { (document.getElementById("au") as HTMLAudioElement).src = u!; }, enclosure);
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
});

test("the enclosure URL goes out unmodified", async ({ page }) => {
  const asked = await stubAudio(page);
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await page.waitForFunction(() => (document.getElementById("au") as HTMLAudioElement).readyState >= 1, null, { timeout: 15000 });

  expect(asked.length).toBeGreaterThan(0);
  // Blubrry keys episode identity on the exact URL — a ?t= would split one episode in two.
  for (const url of asked) expect(url).not.toMatch(/[?&]t=/);
  const core = await page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
  const enclosures = new Set(core.episodes.map(e => e.enclosure).filter(Boolean));
  expect(enclosures.has(asked[0]!), "must request an enclosure exactly as the feed publishes it").toBe(true);
});

test("jump plays in the page and seeks to the minute", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await recordSeeks(page);
  const btn = page.locator("#readalong .panel").first().locator("[data-act=cut]");
  const want = Number(await btn.getAttribute("data-secs"));
  await btn.click();
  await page.waitForFunction(() => (document.getElementById("au") as HTMLAudioElement).readyState >= 1, null, { timeout: 15000 });
  await seekLanded(page, want);                     // seeked to the logged minute

  const s = await page.evaluate(() => ({
    src: (document.getElementById("au") as HTMLAudioElement).src,
    inline: !!document.querySelector<HTMLElement>(".panel.playing .player"),
  }));
  expect(s.src).toBeTruthy();
  expect(s.inline).toBe(true);                      // the player opened in the clicked panel
});

test("playback survives navigation via the mini-bar", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await page.waitForFunction(() => !(document.getElementById("au") as HTMLAudioElement).paused, null, { timeout: 15000 });
  await expect(page.locator("#minibar")).not.toHaveClass(/\bon\b/);   // inline player is alive

  const before = await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).currentTime);
  await page.locator(".crumb a").click();                             // navigate away
  /* Wait for the tape to actually advance rather than for a fixed 1.2s. Under full-suite
     load the timer expired before playback had moved, which read as a stall. */
  await page.waitForFunction(t => (document.getElementById("au") as HTMLAudioElement).currentTime > t, before, { timeout: 15000 });

  const after = await page.evaluate(() => ({
    playing: !(document.getElementById("au") as HTMLAudioElement).paused,
    t: (document.getElementById("au") as HTMLAudioElement).currentTime,
    label: document.getElementById("mb-cm")!.textContent,
  }));
  expect(after.playing).toBe(true);
  expect(after.t).toBeGreaterThan(before);
  await expect(page.locator("#minibar")).toHaveClass(/\bon\b/);
  expect(after.label.length).toBeGreaterThan(0);
});

test("the mini-bar can pause and close", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await page.waitForFunction(() => !(document.getElementById("au") as HTMLAudioElement).paused, null, { timeout: 15000 });
  await page.locator(".crumb a").click();
  await expect(page.locator("#minibar")).toHaveClass(/\bon\b/);

  await page.locator("#mb-pp").click();
  await expect.poll(() => page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).paused)).toBe(true);

  await page.locator("#mb-x").click();
  await expect(page.locator("#minibar")).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).getAttribute("src"))).toBeNull();
});

test("an episode with no audio says so rather than offering a dead control", async ({ page }) => {
  await stubAudio(page);
  /* No real record both lacks an enclosure and carries mentions, so this honest-refusal
     path — the one playAffordance() renders when ep.enclosure is null — had zero coverage
     and the guard that hunted for it could never be satisfied. Manufacture the case. */
  let key: string | null = null;
  await page.route("**/d/core.json", async route => {
    const res = await route.fetch();
    const core = await res.json() as CoreData;
    const ep = core.episodes.find(e => e.enclosure && e.mentionCount > 2);
    if (!ep) throw new Error("no episode with an enclosure and enough mentions to stub");
    key = ep.key;
    ep.enclosure = null;
    await route.fulfill({ response: res, json: core });
  });

  await page.goto("/");
  /* Not waitForSelector("body[data-ready]"): that flag is set at module scope, before
     core.json is even requested, so under load we read `key` before the route ran. Wait
     for the interception itself. */
  await expect.poll(() => key, { timeout: 15000 }).not.toBeNull();

  await page.goto("/#/ep/" + encodeURIComponent(key!));
  await page.waitForSelector("#readalong .panel");
  // Not one play control anywhere, and every row says why.
  expect(await page.locator("#readalong button[data-act=cut]").count()).toBe(0);
  expect(await page.locator(".meta .big-play").count()).toBe(0);
  await expect(page.locator("#readalong .ts.dead").first()).toContainText("No audio on file");
  // The colophon must not promise jumps it cannot honour either.
  expect(await page.locator(".colo").innerText()).toMatch(/0 playable/i);
});

test("a segment stops at the next logged minute and hands over the player", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);

  const real = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#readalong .panel")].map(el => ({ secs: el.dataset.secs, until: el.dataset.until })));
  test.skip(real.length < 2 || !real[0]?.until, "episode has no second timestamp");
  // Each mention's segment really does end where the next one starts.
  expect(Number(real[0]!.until)).toBe(Number(real[1]!.secs));

  await shortSegment(page);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();

  await page.waitForFunction(
    () => (document.getElementById("au") as HTMLAudioElement).paused &&
          [...document.querySelectorAll<HTMLElement>("#readalong .panel")].indexOf(document.querySelector<HTMLElement>("#readalong .panel.playing")!) === 1,
    null, { timeout: 20000 });

  const s = await page.evaluate(() => {
    const playing = document.querySelector<HTMLElement>("#readalong .panel.playing");
    return {
      paused: (document.getElementById("au") as HTMLAudioElement).paused,
      open: !!playing!.querySelector<HTMLElement>(".player"),
      seeked: Math.round((document.getElementById("au") as HTMLAudioElement).currentTime),
      expected: Number(playing!.dataset.secs),
    };
  });
  expect(s.paused).toBe(true);                 // stopped, per the segment boundary
  expect(s.open).toBe(true);                   // player moved to the next timestamp and opened
  expect(Math.abs(s.seeked - s.expected)).toBeLessThan(4);
});

test("the inline play/pause button tracks the audio state", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();
  await page.waitForFunction(() => !(document.getElementById("au") as HTMLAudioElement).paused, null, { timeout: 15000 });

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

test("Let it roll is off by default and keeps the tape running when ticked", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  const roll = page.locator('#readalong [data-act="roll"]');
  await expect(roll).toBeVisible();
  await expect(roll).not.toBeChecked();        // sampling one comic is the default

  await roll.check();
  await shortSegment(page);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();

  // The UI walks to the next comic, and the audio never stops.
  await page.waitForFunction(
    () => [...document.querySelectorAll<HTMLElement>("#readalong .panel")]
      .indexOf(document.querySelector<HTMLElement>("#readalong .panel.playing")!) === 1,
    null, { timeout: 20000 });
  expect(await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).paused)).toBe(false);
});

test("the roll preference persists", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.locator('#readalong [data-act="roll"]').check();
  await page.reload();
  await page.waitForSelector("#readalong .panel");
  await expect(page.locator('#readalong [data-act="roll"]')).toBeChecked();

  await page.locator('#readalong [data-act="roll"]').uncheck();
  await page.reload();
  await page.waitForSelector("#readalong .panel");
  await expect(page.locator('#readalong [data-act="roll"]')).not.toBeChecked();
});

test("the stub is long enough for these seeks", () => {
  expect(FAKE_AUDIO_SECONDS).toBeGreaterThan(60);
});

test("the last jump clicked is the one that plays", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  // Restamp inside the stub's runtime; real timestamps are minutes into the episode.
  await shortSegment(page, 4);
  const jumps = page.locator("#readalong button.ts[data-act='cut']");
  if (await jumps.count() < 2) test.skip(true, "episode has fewer than two jumpable comics");

  await recordSeeks(page);
  const wanted = Number(await jumps.nth(1).getAttribute("data-secs"));
  // Back to back, so the second lands while the first may still be loading. The first
  // click's captured seconds used to win via a stale loadedmetadata closure.
  await jumps.nth(0).click();
  await jumps.nth(1).click();

  await page.waitForFunction(() => {
    const a = document.getElementById("au") as HTMLAudioElement;
    return a && a.readyState >= 1;
  }, null, { timeout: 15000 });
  /* The seek is the assertion. A fixed 400ms then |t - wanted| < 2 raced the running tape,
     and shortSegment puts the next boundary only 4s past `wanted` — the tolerance was gone
     long before the check ran. */
  await seekLanded(page, wanted);
  // ...and the UI agrees with the tape.
  await expect(page.locator(".panel.playing")).toHaveCount(1);
  const playingSecs = await page.locator(".panel.playing").getAttribute("data-secs");
  expect(Number(playingSecs)).toBe(wanted);
});

test("the mini-bar takes over when the panel is destroyed while paused", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act='cut']").first().click();
  await page.waitForSelector(".panel.playing .player");
  // Wait for playback to actually start: au.play() is async, and pausing before its
  // promise settles lets the resolution flip paused back to false.
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);
  await page.locator(".panel.playing .player .pp").click();      // pause
  await expect(page.locator("#au")).toHaveJSProperty("paused", true);

  // Re-render the read-along in another layout: same route, no media event, panel gone.
  await page.getByRole("button", { name: "Timestamps" }).click();
  await expect(page.locator(".panel.playing .player")).toHaveCount(0);
  // Paused audio fires nothing, so without a DOM-driven repaint there was no control at all.
  await expect(page.locator("#minibar")).toHaveClass(/\bon\b/);
});

/* Moved here from episode.spec.js, where it could not click: it asserted only that the row
   it found carries a numeric data-secs, which readalong.ts guarantees for every element the
   locator can match. The behaviour in its name — playing in place — was never exercised. */
test("a timestamp row plays in place", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.getByRole("button", { name: "Timestamps" }).click();
  const row = page.locator("#readalong .rawrap.panel button.ra-row[data-act=cut]").first();
  await expect(row).toBeVisible();

  await recordSeeks(page);
  const want = Number(await row.locator("..").getAttribute("data-secs"));
  await row.click();
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);
  await seekLanded(page, want);
  // The player opens inside the row's own wrapper, not somewhere else on the page.
  await expect(page.locator("#readalong .rawrap.playing .player")).toHaveCount(1);
});

/* "Play from the top" is the primary way to start an episode and had zero behavioural
   coverage: episode.spec asserted it is visible, matches /Play from the top/ and sits after
   .tags, and nothing clicked it. Its handler is a distinct branch (act === "cut-ep" ? 0),
   and it resolves its panel to .meta — the one container whose .cutslot is in no read-along
   layout, so no other test touches that path. */
test("Play from the top starts the episode at zero, from the published enclosure", async ({ page }) => {
  const asked = await stubAudio(page);
  await openEpisode(page);
  await page.locator(".meta .big-play").click();
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);

  expect(await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).currentTime)).toBeLessThan(2);
  await expect(page.locator(".meta .player")).toHaveCount(1);

  // Stats correctness: the enclosure must go out exactly as the feed publishes it.
  expect(asked.length).toBeGreaterThan(0);
  const enclosures = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
    return core.episodes.map(e => e.enclosure).filter(Boolean);
  });
  expect(new Set(enclosures).has(asked[0]!)).toBe(true);
  for (const url of asked) expect(url).not.toMatch(/[?&]t=/);
});

/* The error listener added by the last review had no coverage at all: fake-audio.js fulfils
   every media request, so no spec ever produced a failing enclosure. It exists to stop one
   dead load from marking that episode loaded forever — au.dataset.ep is stamped before the
   load resolves, so every later click would take the "same tape" branch and seek a source
   that was never there. */
test("a dead enclosure says so, and the next click retries for real", async ({ page }) => {
  await stubAudio(page);
  /* Registered after the stub on purpose: Playwright matches routes in reverse registration
     order, so this one sees the request first and hands the retry back to the stub. */
  let failFirst = true;
  await page.route(/blubrry\.com|podtrac\.com|\.mp3|simplecastcdn\.com\/media/, async route => {
    if (failFirst) { failFirst = false; await route.abort(); return; }
    await route.fallback();
  });
  await openEpisode(page);

  await page.locator("#readalong button.ts[data-act=cut]").first().click();

  // No player left claiming to be playing, and the failure is stated rather than mimed.
  await expect(page.locator("#readalong .panel .player .note")).toContainText("didn’t load");
  await expect(page.locator("#readalong .panel.playing")).toHaveCount(0);
  await expect(page.locator("#minibar")).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).dataset.ep)).toBeUndefined();

  // ...and because dataset.ep was cleared, the same control loads the tape on a retry.
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);
});

test("a segment handover keeps focus on a player, not on <body>", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  const seg = await shortSegment(page, 4);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();
  await page.waitForSelector(".panel.playing .player");
  // Put focus where a keyboard listener would have it: on the player's own control.
  await page.locator(".panel.playing .player .pp").focus();
  expect(await page.evaluate(() => document.activeElement?.className)).toContain("pp");

  // Ride past the boundary; the engine destroys this player and opens the next one.
  await page.waitForFunction(i => {
    const panels = [...document.querySelectorAll<HTMLElement>("#readalong .panel")];
    return panels.indexOf(document.querySelector<HTMLElement>("#readalong .panel.playing")!) === i;
  }, 1, { timeout: 20000 });

  // Focus used to land on <body>, mid-playback, with no way back to the controls.
  const active = await page.evaluate(() => ({
    cls: document.activeElement?.className ?? "",
    inPlayer: !!document.activeElement?.closest?.(".panel.playing .player"),
  }));
  expect(active.inPlayer, `focus was on ${active.cls || "<body>"}`).toBe(true);
});

/* ---------------------------------------------------------------------------------------
   Plan 3 Task 4 — Media Session and playhead sync.
   --------------------------------------------------------------------------------------- */

const session = (page: Page) => page.evaluate(() => {
  const ms = navigator.mediaSession;
  const m = ms?.metadata;
  return {
    state: ms?.playbackState ?? null,
    title: m?.title ?? null,
    artist: m?.artist ?? null,
    album: m?.album ?? null,
    art: m?.artwork?.[0]?.src ?? null,
  };
});

/** The episode record behind a panel, so assertions compare against the data, not the DOM. */
const episodeOf = (page: Page, key: string) => page.evaluate(async k => {
  const core = await fetch("d/core.json").then(r => r.json() as Promise<CoreData>);
  return core.episodes.find(e => e.key === k);
}, key);

/**
 * Capture the handlers the engine registers with the OS.
 *
 * Chromium exposes no way to fire a real lock-screen action, and a test that only checked
 * `setActionHandler` exists would pass against a handler that did nothing. Wrapping it
 * before the page's own scripts run means the spec can invoke the exact function the OS
 * would, and assert where the tape actually landed.
 */
async function captureTransport(page: Page) {
  await page.addInitScript(() => {
    const ms = navigator.mediaSession;
    if (!ms?.setActionHandler) return;
    window.__transport = {};
    const real = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, handler) => {
      window.__transport![action] = handler as (details?: { seekTime?: number }) => void;
      return real(action, handler);
    };
  });
}

test("the lock screen is told what is playing, and told when it stops", async ({ page }) => {
  await captureTransport(page);
  await stubAudio(page);
  await openEpisode(page);
  test.skip(!await page.evaluate(() => "mediaSession" in navigator), "no Media Session here");

  expect((await session(page)).title).toBeNull();

  const row = page.locator("#readalong .panel").first();
  const [comic, key] = [await row.getAttribute("data-comic"), await row.getAttribute("data-ep")];
  await row.locator("[data-act=cut]").click();
  /* Wait for the player, not for `paused` to flip. Metadata is published by `paintBar()` the
     moment the jump opens a player, and tying the assertion to real playback would make it
     depend on the OS actually rendering audio — which these specs deliberately never do. */
  await page.waitForSelector(".panel.playing .player");

  const on = await session(page);
  const ep = await episodeOf(page, key!);
  // The comic leads, because a jump plays a comic, not a whole episode.
  expect(on.title).toBe(comic);
  expect(on.album).toBe("I Read Comic Books");
  // The state the OS is shown has to be the state the element is actually in.
  expect(on.state).toBe(await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).paused ? "paused" : "playing"));
  /* The episode title and panel are the second line — read from core.json, not the heading,
     which the stylesheet renders uppercase and innerText returns transformed. */
  expect(on.artist).toContain(ep!.title);
  expect(on.art).toBe(ep!.artwork);

  await page.evaluate(() => { const a = document.getElementById("au") as HTMLAudioElement; a.pause(); a.dispatchEvent(new Event("pause")); });
  await expect.poll(async () => (await session(page)).state).toBe("paused");

  /* Stop from the OS itself. The mini-bar's ✕ is the other way in, but it only exists once
     navigation has eaten the inline player, and this is the path the lock screen uses. */
  await page.evaluate(() => window.__transport!.stop!());
  // Never left claiming a session that ended — the lock screen would go on showing it.
  const off = await session(page);
  expect(off.title).toBeNull();
  expect(off.state).toBe("none");
});

test("an OS seek moves the tape and never touches the enclosure URL", async ({ page }) => {
  await captureTransport(page);
  const asked = await stubAudio(page);
  await openEpisode(page);
  test.skip(!await page.evaluate(() => "mediaSession" in navigator), "no Media Session here");

  await shortSegment(page);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();
  await page.waitForSelector(".panel.playing .player");
  /* The player opens synchronously, but the tape is not seekable until `loadedmetadata`
     lands — and `applyPending` then seeks it to the jump's own second. Riding before that
     means the engine overwrites the position under test. */
  await page.waitForFunction(() => (document.getElementById("au") as HTMLAudioElement).readyState >= 1, null, { timeout: 20000 });
  await recordSeeks(page);

  const wired = await page.evaluate(() => Object.keys(window.__transport ?? {}));
  expect(wired).toEqual(expect.arrayContaining(["play", "pause", "seekto", "seekbackward", "seekforward"]));

  // Drive the handler the OS would call.
  await page.evaluate(() => window.__transport!.seekto!({ seekTime: 120 }));
  await seekLanded(page, 120);

  /* Rule 3, and the whole reason the OS seek routes through the same `scrub()`: Blubrry
     keys episode identity on the exact enclosure URL, so a seek must never become a
     parameter on it. */
  expect(asked.length).toBeGreaterThan(0);
  for (const url of asked) expect(url).not.toMatch(/[?&](t|start|seek)=/);

  /* ...and it inherits the slider's opt-out. The boundary check runs on timeupdate, so fire
     one — waiting for playback to produce it would make the assertion depend on the OS
     actually rendering audio, and then it passes whether the opt-out exists or not. Without
     the opt-out this seek to 2:00, far past a 6-second segment, reads as a finished segment:
     the engine pauses and hands the player to the next panel. */
  await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).dispatchEvent(new Event("timeupdate")));
  const stayed = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>("#readalong .panel")];
    return panels.indexOf(document.querySelector<HTMLElement>("#readalong .panel.playing")!);
  });
  expect(stayed).toBe(0);
  expect(await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).currentTime)).toBeGreaterThan(100);

  await page.evaluate(() => window.__transport!.pause!());
  await expect(page.locator("#au")).toHaveJSProperty("paused", true);
});

test("the read-along marks the comic the tape is actually on", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);

  /* Restamp into the stub's runtime, and only `data-secs` — leaving `data-until` alone
     keeps the segment machinery out of it, which is the point: this marker has to come
     from the playhead, not from a jump or a handover. */
  const stamps = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>("#readalong .panel")];
    panels.forEach((p, i) => { p.dataset.secs = String(2 + i * 6); });
    return panels.map(p => Number(p.dataset.secs));
  });
  test.skip(stamps.length < 2, "episode has fewer than two logged minutes");

  // Play from the top: nothing was jumped to, so only the playhead can mark anything.
  await page.locator(".meta .big-play").click();
  await page.waitForSelector(".meta .player");
  /* The player opens synchronously, but the tape is not seekable until `loadedmetadata`
     lands — and `applyPending` then seeks it to the jump's own second. Riding before that
     means the engine overwrites the position under test. */
  await page.waitForFunction(() => (document.getElementById("au") as HTMLAudioElement).readyState >= 1, null, { timeout: 20000 });
  /* Then pause and drive the playhead by seeking. Riding a running tape would race the
     assertion — six seconds between stamps is less than a poll timeout, so a correct marker
     moves off the row under test before it can be read — and it is the playhead POSITION
     under test here, not whether the OS can render audio. */
  await page.evaluate(() => (document.getElementById("au") as HTMLAudioElement).pause());

  const marked = () => page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>("#readalong .panel")];
    return panels.indexOf(document.querySelector<HTMLElement>("#readalong .panel.now")!);
  });
  const rideTo = async (secs: number) => page.evaluate(s => { (document.getElementById("au") as HTMLAudioElement).currentTime = s; }, secs);

  await rideTo(stamps[1]! + 1);
  await expect.poll(marked).toBe(1);

  // It moves back when the tape does. A marker that only ever advances is a latch.
  await rideTo(stamps[0]! + 1);
  await expect.poll(marked).toBe(0);

  /* Before the first logged minute nothing is claimed, rather than the first row by default.
     Counted, not indexed: `marked()` returns -1 both for "no row is marked" and for "the
     marked row is a stale node that is no longer in this list", so an index cannot tell the
     clearing apart from a re-render and the assertion could not fail. */
  await rideTo(0);
  await expect(page.locator(".now")).toHaveCount(0);

  // Stopping clears it; a stale marker says the tape is somewhere it is not.
  await rideTo(stamps[1]! + 1);
  await expect.poll(marked).toBe(1);
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  await page.locator("#mb-x").click();
  await expect(page.locator(".now")).toHaveCount(0);
});
