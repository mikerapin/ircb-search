import { test, expect } from "@playwright/test";
import { stubAudio } from "./fake-audio.js";

/**
 * Regression tests for fixes that shipped with nothing holding them in place.
 *
 * Review 2's own highest-value finding was that the audio `error` listener from review 1
 * had no test — "a fix from the last pass with nothing holding it in place". The review-2
 * fixes then repeated it: five behavioural changes landed with no spec that would go red on
 * a revert. Each test below was verified by mutation — revert the fix, the test fails.
 */

async function openEpisode(page) {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator(".cover-hero .big-play").click();
  await page.waitForSelector("#readalong .panel");
}

/* Compress the first two segments into the stub's runtime, the way audio.spec does. */
async function shortSegment(page, len = 6) {
  return page.evaluate(l => {
    const [first, second] = document.querySelectorAll("#readalong .panel");
    first.dataset.secs = "2";
    first.dataset.until = String(2 + l);
    first.querySelector("[data-act=cut]").dataset.secs = "2";
    if (second) { second.dataset.secs = String(2 + l); second.dataset.until = String(2 + l * 2); }
    return { secs: 2, until: 2 + l };
  }, len);
}

test("dragging the seek slider past the segment end does not rewind you to it", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  const seg = await shortSegment(page);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();
  await page.waitForSelector(".panel.playing .player");
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);

  /* The slider's max is the whole episode, so it promises the whole episode. Without the
     opt-out, the next timeupdate read this drag as a completed segment: paused, handed over
     to the next panel and seeked backwards to that panel's start. */
  await page.evaluate(() => {
    const s = document.querySelector(".panel.playing .player [data-role=seek]");
    s.value = "45";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(700);
  const t = await page.evaluate(() => document.getElementById("au").currentTime);
  expect(t, `rewound to the segment boundary at ${seg.until}s`).toBeGreaterThan(20);
});

test("mini-bar Stop and close leaves focus in the page, not on <body>", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.locator("#readalong button.ts[data-act=cut]").first().click();
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);
  await page.locator(".crumb a").click();
  await expect(page.locator("#minibar")).toHaveClass(/\bon\b/);

  // .on toggles back to display:none, which blurs the button that was just activated —
  // the same bug closeMenu() guards against in shell.ts.
  await page.locator("#mb-x").focus();
  await page.locator("#mb-x").click();
  const active = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  expect(active, "focus fell out of the page").toBe("view");
});

test("ArrowDown reopens the typeahead after Escape", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator("#q").click();
  await expect(page.locator("#ta")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ta")).toBeHidden();

  // Escape was the only documented way to dismiss the popover, and it left no way back.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#ta")).toBeVisible();
  await expect(page.locator("#ta .ta-opt.act")).toHaveCount(1);
});

test("typeahead options are out of the tab order, and the popover dies with the focus", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator("#q").click();
  await expect(page.locator("#ta .ta-opt").first()).toBeVisible();

  /* A combobox driven by aria-activedescendant must keep DOM focus on the input. These are
     bare <a href> from opt(), so without tabindex=-1 both mechanisms are live and disagree. */
  const tabindexes = await page.locator("#ta .ta-opt").evaluateAll(els => els.map(e => e.getAttribute("tabindex")));
  expect(tabindexes.length).toBeGreaterThan(0);
  expect(new Set(tabindexes)).toEqual(new Set(["-1"]));

  // Tab must leave the combobox entirely rather than walking into the options.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest?.("#ta") != null)).toBe(false);
  await expect(page.locator("#ta")).toBeHidden();
});

test("clicking a typeahead option still navigates, and never steals focus", async ({ page }) => {
  // The popover swallows mousedown so the input never blurs; nothing else in the suite
  // clicks an option with the mouse, so a broken guard would go unnoticed.
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator("#q").click();
  const opt = page.locator("#ta .ta-opt").first();
  await expect(opt).toBeVisible();

  await opt.hover();
  await page.mouse.down();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("q");
  await page.mouse.up();
  await expect(page).toHaveURL(/#\/(series|search|ep|who|panel|index|about|subscribe|wall)/);
});

test("two comics logged at the same minute hand over forwards, not backwards", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);

  /* boundary() in readalong.ts requires a *strictly later* minute, so when two comics share
     a stamp the segment end skips past the twin — while plain DOM order handed over to it,
     and its data-secs is the minute already playing, seeking the tape backwards.
     The bug only shows when playback STARTS on the first of the twins, so panel 1 is the
     one clicked and panel 2 is its twin. Panel 3 is the correct target. */
  const ok = await page.evaluate(() => {
    const p = [...document.querySelectorAll("#readalong .panel")];
    if (p.length < 4) return false;
    const set = (el, secs, until) => {
      el.dataset.secs = String(secs);
      if (until == null) delete el.dataset.until; else el.dataset.until = String(until);
      const b = el.querySelector("[data-act=cut]");
      if (b) b.dataset.secs = String(secs);
    };
    set(p[0], 1, 2);
    set(p[1], 2, 8);       // clicked; its segment ends at 8, skipping the twin
    set(p[2], 2, 8);       // the twin — same minute, must NOT be handed to
    set(p[3], 8, 20);      // the real next segment
    return true;
  });
  test.skip(!ok, "episode has fewer than four panels");

  await page.locator("#readalong .panel").nth(1).locator("[data-act=cut]").click();
  // Ride past the boundary at 8s; the handover must skip the twin and land on panel 3.
  await page.waitForFunction(() => {
    const p = [...document.querySelectorAll("#readalong .panel")];
    return p.indexOf(document.querySelector("#readalong .panel.playing")) !== 1;
  }, null, { timeout: 20000 });

  const landed = await page.evaluate(() => {
    const p = [...document.querySelectorAll("#readalong .panel")];
    const playing = document.querySelector("#readalong .panel.playing");
    return { idx: p.indexOf(playing), secs: Number(playing.dataset.secs), t: document.getElementById("au").currentTime };
  });
  expect(landed.idx, "handed over to the twin, which shares the minute just played").toBe(3);
  expect(landed.secs).toBe(8);
  expect(landed.t, "tape was seeked backwards past the boundary").toBeGreaterThan(6);
});

test("the seek slider's spoken position matches its thumb", async ({ page }) => {
  await stubAudio(page);
  await openEpisode(page);
  await page.locator("#readalong .panel").first().locator("[data-act=cut]").click();
  await page.waitForSelector(".panel.playing .player");
  await expect(page.locator("#au")).toHaveJSProperty("paused", false);

  /* step=15 snaps `value`, while aria-valuetext used to be written from the unsnapped
     currentTime — the two numbers a screen reader can read off the slider described
     instants up to 14 seconds apart. */
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const el = document.querySelector(".panel.playing .player [data-role=seek]");
    const clock = n => {
      const x = Math.floor(n), h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = x % 60;
      return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(sec).padStart(2, "0");
    };
    return { value: Number(el.value), step: el.step, spoken: el.getAttribute("aria-valuetext"), expect: clock(Number(el.value)) };
  });
  expect(Number(s.value) % Number(s.step)).toBe(0);   // the browser really does snap
  expect(s.spoken).toBe(s.expect);
});

test("the generated plate's publisher line carries no element opacity", async ({ page }) => {
  /* House rule 1. Element opacity on small text has failed AA seven times because it
     composites over whichever of the eight plate pairs the hash picked — .gc-pub at 7.5px
     bottomed out at 1.32:1 on ink/yellow in the negative. Assert the *rule*, not a ratio:
     which pair this plate gets depends on the series name, so a contrast sample here would
     be flaky for reasons unrelated to the bug. */
  await page.goto("/");
  await page.waitForSelector(".rack .slot");
  const ops = await page.locator(".rack .gc-pub").evaluateAll(els => els.map(e => getComputedStyle(e).opacity));
  expect(ops.length).toBeGreaterThan(0);
  expect(new Set(ops)).toEqual(new Set(["1"]));
});

test("a mention whose stamp runs past its episode says so, instead of 'no minute logged'", async ({ page }) => {
  /* jumpable() rejects a stamp beyond the runtime, and the refusal used to claim no minute
     was logged — contradicting About the Data, which counts that record under "Bad stamps".
     One real mention is in this state, so find it rather than manufacture it. */
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const hit = await page.evaluate(async () => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json()),
      fetch("d/mentions.json").then(r => r.json()),
    ]);
    const byKey = new Map(core.episodes.map(e => [e.key, e]));
    const m = men.find(x => {
      const e = byKey.get(x.epKey);
      return x.secs != null && x.secs > 0 && e?.enclosure && e.runtimeSecs != null && x.secs >= e.runtimeSecs;
    });
    return m ? { key: m.epKey, comic: m.comic } : null;
  });
  test.skip(!hit, "no mention carries a stamp past its runtime");

  await page.goto("/#/ep/" + encodeURIComponent(hit.key));
  await page.waitForSelector("#readalong .panel");
  const row = page.locator("#readalong .panel", { hasText: hit.comic }).locator(".ts.dead").first();
  await expect(row).toContainText("Timestamp out of range");
  await expect(row).not.toContainText("No minute logged");
});
