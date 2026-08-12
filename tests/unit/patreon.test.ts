import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { CoreData } from "../../src/data/types";

/**
 * The Patreon shelf used to be 146 hand-typed rows in the upstream table with no date and no
 * link, and the test here watched for a new spin-off arriving unmatched by
 * `data/patreon-series.json`. `fetch_patreon.py` reads the Secret Feed directly now, so every
 * Patreon episode arrives with its own date and its own post URL and that failure mode is
 * gone. What replaces it is a sharper worry.
 *
 * The feed's `<enclosure>` embeds a per-patron signature — `/api/rss/u/<token>/e/<id>.mp3?sig=`
 * — and publishing one would hand a private feed to anyone who read the built site. The fetch
 * drops it and `shapePatreonEpisodes` sets `enclosure: null`, so two separate things have to
 * stay right. This is what notices if either stops.
 *
 * It reads the built chunk on purpose: a fixture cannot leak a real token, so it could not
 * fail for the reason this exists.
 */

const PATH = "public/d/core.json";

function core(): CoreData {
  expect(existsSync(PATH), `${PATH} is generated — run \`npm run build\` first`).toBe(true);
  return JSON.parse(readFileSync(PATH, "utf8")) as CoreData;
}

const patreonOnly = (data: CoreData) => data.episodes.filter(e => e.key.startsWith("p:"));

describe("the Patreon feed", () => {
  it("never ships a per-patron media URL", () => {
    const data = core();
    const leaked = patreonOnly(data).filter(e => e.enclosure !== null);
    expect(leaked.map(e => e.title), "enclosure must stay null on Patreon episodes").toEqual([]);

    /* Belt and braces, against the whole file rather than one field: the signature pattern
       must not appear anywhere, however it got there. */
    expect(readFileSync(PATH, "utf8")).not.toMatch(/\/api\/rss\/u\/[^/]+\/e\//);
  });

  it("gives every Patreon episode a public post page to link to", () => {
    const unlinked = patreonOnly(core())
      .filter(e => !e.patreonUrl?.startsWith("https://www.patreon.com/ircbpodcast/posts/"))
      .map(e => e.title);
    expect(unlinked, "every Patreon episode needs its own post URL").toEqual([]);
  });

  it("points every post-credits segment at an episode that exists", () => {
    const data = core();
    const keys = new Set(data.episodes.map(e => e.key));
    const dangling = patreonOnly(data)
      .filter(e => e.parentKey !== null && !keys.has(e.parentKey))
      .map(e => e.title);
    expect(dangling, "parentKey must resolve; the two feeds title episodes differently").toEqual([]);
  });

  it("gives post-credits segments no mentions of their own", () => {
    /* They are chatter recorded after a taping. Copying the parent episode's comics onto them
       would assert they discussed books they never named, and those false mentions would then
       inflate every series page and panelist percentage that counts them. */
    const withMentions = patreonOnly(core())
      .filter(e => e.parentKey !== null && e.mentionCount > 0)
      .map(e => e.title);
    expect(withMentions).toEqual([]);
  });

  it("has replaced the undated shelf rather than adding to it", () => {
    const stranded = core().episodes.filter(e => !e.showId && !e.date && !e.patreonUrl);
    expect(stranded.map(e => e.title), "the hand-typed shelf should be gone").toEqual([]);
  });

  it("every series pattern still matches something, so a rename is noticed", () => {
    const data = core();
    const dead = data.patreonSeries
      .filter(s => !data.episodes.some(e => e.title?.includes(s.pattern)))
      .map(s => s.pattern);
    expect(dead, "these patterns no longer match any episode").toEqual([]);
  });
});
