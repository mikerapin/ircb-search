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

/** Same folding the shaper uses to match a segment to its episode across the two feeds. */
const titleish = (t: string) =>
  t.replace(/^\s*episode\s+\d+\s*[|:]\s*/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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

  it("borrows the panel from the episode a post-credits segment follows", () => {
    /* The feed credits nobody, so these read "Panel unknown" beside the episode they were
       recorded straight after, by the same three people. */
    const data = core();
    const byKey = new Map(data.episodes.map(e => [e.key, e]));
    const wrong = patreonOnly(data)
      .filter(e => e.parentKey)
      .filter(e => {
        const parent = byKey.get(e.parentKey!);
        return parent && parent.people.join("|") !== e.people.join("|");
      })
      .map(e => e.title);
    expect(wrong, "a segment's panel should match its episode's").toEqual([]);
  });

  it("holds back an episode that reached Patreon before the public feed", () => {
    /* Patrons get the week's episode early. Publishing it then means a card with no panel,
       no comics and no minutes, spoiling a title before it airs. The pair returns on the
       refresh after Simplecast has it. The tell is a post-credits segment whose parent is
       not public but is another item in the same feed. */
    const data = core();
    const shown = new Set(patreonOnly(data).map(e => titleish(e.title)));
    const early = patreonOnly(data)
      .filter(e => !e.parentKey && /post[\s-]*credits?/i.test(e.title))
      .filter(e => shown.has(titleish(e.title.replace(/post[\s-]*credits?/i, ""))))
      .map(e => e.title);
    expect(early, "these and their episode should wait for the public release").toEqual([]);
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
    const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const dead = data.patreonSeries
      .filter(s => !data.episodes.some(e => loose(e.title ?? "").includes(loose(s.pattern))))
      .map(s => s.pattern);
    expect(dead, "these patterns no longer match any episode").toEqual([]);
  });

  it("notices a run in the feed that the house ad does not promote", () => {
    /* The ad is editorial — data/patreon-series.json decides what gets sold — but it went
       stale silently: it named seven runs covering 150 of 300 episodes, and the JLI series
       launched in July invisible to it. Nothing failed, because the old guard only checked
       that listed patterns still matched.

       This looks the other way. Titles are clustered on their opening words, and a cluster
       big enough to be a run rather than a one-off has to be either promoted or deliberately
       left off. Adding it to patreon-series.json is the fix. */
    const data = core();
    const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const patterns = data.patreonSeries.map(s => loose(s.pattern));

    /* Cluster on the opening words, but judge coverage by whether the episodes themselves
       match a promoted pattern. Comparing the stem to the pattern looks equivalent and is
       not: "Mike & Paul Read Doom Patrol Part 6" stems to "mike paul read", which contains
       no pattern even though the episode is promoted under "Doom Patrol". */
    const clusters = new Map<string, string[]>();
    for (const e of patreonOnly(data)) {
      const stem = loose(e.title).split(" ").slice(0, 3).join(" ");
      if (stem.length < 6) continue;
      (clusters.get(stem) ?? clusters.set(stem, []).get(stem)!).push(e.title);
    }

    const covered = (title: string) => patterns.some(p => loose(title).includes(p));
    const unpromoted = [...clusters]
      .filter(([, titles]) => titles.length >= 4 && !titles.some(covered))
      .map(([stem, titles]) => `${stem} (${titles.length})`);

    expect(unpromoted, "add these to data/patreon-series.json, or widen a pattern").toEqual([]);
  });
});
