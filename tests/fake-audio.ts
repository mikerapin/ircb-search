import type { Page, Route } from "@playwright/test";

/**
 * Test doubles for the podcast audio.
 *
 * The specs must never fetch the real enclosure. Those URLs run through
 * media.blubrry.com → dts.podtrac.com, and a request that delivers a minute of audio is a
 * counted download under IAB 2.x — a test suite hitting them would quietly inflate the
 * show's numbers, which is the one statistic the whole site is careful about.
 *
 * So we intercept and serve silence, and assert on the URL that was *requested*. That is
 * the thing worth checking anyway: the enclosure must reach the network unmodified.
 */

const RATE = 8000;              // 8 kHz, 8-bit mono — a minute costs 480 KB
const SECONDS = 240;

function silentWav(seconds = SECONDS, rate = RATE) {
  const data = Buffer.alloc(seconds * rate, 128);   // 128 is silence for unsigned 8-bit
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);       // PCM
  h.writeUInt16LE(1, 22);       // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h as unknown as Uint8Array, data as unknown as Uint8Array]);
}

const BODY = silentWav();

export const FAKE_AUDIO_SECONDS = SECONDS;

/** The same silence as a data: URI, for a check that must not involve the app or the network. */
export const SILENT_WAV_URI = "data:audio/wav;base64," + silentWav(5).toString("base64");

/**
 * Pull every logged minute on the page inside the stub's runtime, keeping their order.
 *
 * The read-along stamps real data and this tape is four minutes long, so whether a click's
 * target existed was decided by what time that week's hosts reached their first comic.
 * Measured over the archive: 48% of episodes get there after 4:00 and the median is 3:16, so
 * roughly half the time the newest episode — whatever the Wednesday data job last published —
 * asks the player to seek past the end of the tape. Chromium clamps that seek to the
 * duration, fires `seeked` at 240, plays nothing and pauses. Every wait then times out with
 * no error anywhere: `play()` resolves, `readyState` is 4, `au.error` is null. It reads
 * exactly like a broken player.
 *
 * That is why these specs went from intermittently red to permanently red with nobody
 * touching the audio engine, and why they fail identically on CI — same data, same clamp.
 *
 * Restamping keeps what the specs are about, that a click seeks the tape to its own control's
 * `data-secs`, and drops the dependency on which episode is newest. Spacing is derived from
 * how many stamps are on the page so they always fit, and `until` moves with `secs` because
 * one mention's boundary is the next one's start.
 */
export async function stampsInsideTape(page: Page): Promise<number[]> {
  return page.evaluate(tape => {
    const wraps = [...document.querySelectorAll<HTMLElement>("#readalong .panel, #readalong .rawrap")]
      .filter(el => el.dataset["secs"]);
    const step = Math.max(1, Math.floor((tape - 8) / (wraps.length + 1)));
    const out: number[] = [];
    wraps.forEach((el, i) => {
      const secs = 2 + i * step;
      el.dataset["secs"] = String(secs);
      if (el.dataset["until"]) el.dataset["until"] = String(secs + step);
      /* The click handler reads the control's own data-secs first where it has one, so the
         two must not disagree. The Timestamps row carries none and reads the wrapper. */
      const btn = el.querySelector<HTMLElement>("[data-act=cut]");
      if (btn?.dataset["secs"]) btn.dataset["secs"] = String(secs);
      out.push(secs);
    });
    return out;
  }, SECONDS);
}

/**
 * Serves the silence with range support, and records every URL the page asked for.
 * Returns the recorder so a spec can assert the enclosure went out untouched.
 */
export async function stubAudio(page: Page) {
  const requested: string[] = [];
  await page.route(/blubrry\.com|podtrac\.com|\.mp3|simplecastcdn\.com\/media/, async (route: Route) => {
    requested.push(route.request().url());
    const range = route.request().headers()["range"];
    const m = range && /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : BODY.length - 1;
      const slice = BODY.subarray(start, end + 1);
      await route.fulfill({
        status: 206,
        headers: {
          "Content-Type": "audio/wav",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${BODY.length}`,
          "Content-Length": String(slice.length),
        },
        body: slice,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": String(BODY.length) },
      body: BODY,
    });
  });
  return requested;
}

/**
 * Episode keys chosen from the data, for specs that need a particular shape of read-along.
 *
 * `openEpisode` used to click the home hero, which is whichever episode aired last — so every
 * audio spec ran against a target that changed every Wednesday. That is how a 240-second stub
 * came to be tested against a first stamp at 443s for weeks: the property was a coin flip
 * re-tossed by the data job. Grouping raises the stakes, because 71 of 541 episodes log two or
 * more comics at the same second, so about one week in eight the hero would page in moment
 * headers and the panel indices below would mean something else.
 *
 * `plain` wants audio and at least three logged minutes with no two comics sharing one, so
 * every card is its own jump target. `pile` wants the opposite: a minute carrying three or
 * more comics, which is what the moment header exists for.
 */
export async function pickEpisode(page: Page, shape: "plain" | "pile"): Promise<string> {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const key = await page.evaluate(async (want) => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json()),
      fetch("d/mentions.json").then(r => r.json()),
    ]) as [{ episodes: Array<{ key: string; enclosure: string | null }> }, Array<{ epKey: string; secs: number | null }>];
    const per = new Map<string, number[]>();
    for (const m of men) {
      if (m.secs == null) continue;
      const at = per.get(m.epKey) ?? [];
      at.push(m.secs);
      per.set(m.epKey, at);
    }
    for (const e of core.episodes) {
      if (!e.enclosure) continue;
      const stamps = per.get(e.key);
      if (!stamps) continue;
      const counts = new Map<number, number>();
      for (const s of stamps) counts.set(s, (counts.get(s) ?? 0) + 1);
      const biggest = Math.max(...counts.values());
      if (want === "plain" && counts.size >= 3 && biggest === 1) return e.key;
      if (want === "pile" && biggest >= 3) return e.key;
    }
    return null;
  }, shape);
  if (!key) throw new Error(`no ${shape} episode in the index — the picker, not the test, is what broke`);
  return key;
}
