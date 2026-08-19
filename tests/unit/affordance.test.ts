import { it, expect, describe } from "vitest";
import { playAffordance } from "../../src/views/components";
import type { EpisodeCore, Mention } from "../../src/data/types";

/* The three refusals are one branch picking one string, and the fault this guards was that
   branch picking the wrong one: an out-of-range stamp reported as "No minute logged", which
   contradicted About the Data counting the same record under "Bad stamps".
 *
 * It lived in an e2e that searched the live index for a mention already in that state. Zero
 * are, now — the upstream parser fixes cleaned them out — so it skipped, and a guard that
 * skips is a guard reporting nothing. The state is trivial to construct here, and the copy
 * is a pure function of the mention and its episode, so this is where it belongs. What the
 * e2e uniquely proved (a refusal reaches #readalong wearing .ts.dead) is already covered by
 * audio.spec.ts, against the 133 mentions whose episode carries no audio.
 */

const ep = (over: Partial<EpisodeCore> & { key: string }): EpisodeCore => ({
  showId: over.key, title: "", date: null, people: [], runtimeSecs: 3600, mentionCount: 0,
  artwork: null, enclosure: "http://x/a.mp3", simplecastUrl: null, patreonUrl: null,
  ep: null, parentKey: null,
  ...over,
});

const men = (over: Partial<Mention> & { comic: string }): Mention => ({
  series: "Bone", epKey: "a", segment: null, secs: 120, ...over,
});

const withAudio = ep({ key: "a" });
const noAudio = ep({ key: "c", enclosure: null });

describe("playAffordance", () => {
  it("offers a jump when the stamp sits inside the runtime", () => {
    const html = playAffordance(men({ comic: "Bone #1" }), withAudio);
    expect(html).toContain('data-secs="120"');
    expect(html).not.toContain("ts dead");
  });

  it("says the audio is missing, not the minute, when the episode has no enclosure", () => {
    const html = playAffordance(men({ comic: "Bone #2", epKey: "c" }), noAudio);
    expect(html).toContain("No audio on file");
  });

  it("says no minute was logged when the mention carries no stamp", () => {
    const html = playAffordance(men({ comic: "Bone #3", secs: null }), withAudio);
    expect(html).toContain("No minute logged");
    expect(html).not.toContain("Timestamp out of range");
  });

  /* The regression itself. Both assertions matter: the first proves the right string, and
     the second proves it is not falling through to the one it used to print. */
  it("says the stamp runs past the episode, not that no minute was logged", () => {
    const html = playAffordance(men({ comic: "Bone #4", secs: 999999 }), withAudio);
    expect(html).toContain("Timestamp out of range");
    expect(html).not.toContain("No minute logged");
  });
});
