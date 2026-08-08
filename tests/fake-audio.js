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
  return Buffer.concat([h, data]);
}

const BODY = silentWav();

export const FAKE_AUDIO_SECONDS = SECONDS;

/**
 * Serves the silence with range support, and records every URL the page asked for.
 * Returns the recorder so a spec can assert the enclosure went out untouched.
 */
export async function stubAudio(page) {
  const requested = [];
  await page.route(/blubrry\.com|podtrac\.com|\.mp3|simplecastcdn\.com\/media/, async route => {
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
