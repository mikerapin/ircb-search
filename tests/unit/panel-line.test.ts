import { describe, expect, it } from "vitest";

import { feedNumbers } from "../../src/data/numbering";
import { shapePatreonEpisodes } from "../../src/data/shape";
import type { EpisodeCore } from "../../src/data/types";

/**
 * A `Panel:` line in a Patreon description is the one panel source here that is *stated*
 * rather than inferred, so it has to beat every fallback — including a parent episode's
 * borrowed panel, which is otherwise the strongest signal a post-credits segment has.
 *
 * The reason it exists: reading a panel out of prose has a ceiling no parser clears.
 * "IRCB's Best of 2022" names all ten regulars because it lists whose picks were discussed,
 * and "While Mike is in London, Tia, Paul, and Kara..." names someone who was demonstrably
 * absent. Both parse as a panel and both are wrong.
 */
const parent: EpisodeCore[] = [{
  key: "s:1", showId: "1", title: "The Homie Batman", date: "2026-07-29",
  people: ["Mike Rapin", "Brian Murray"], runtimeSecs: null, mentionCount: 0,
  artwork: null, enclosure: null, playerId: null, simplecastUrl: null,
  patreonUrl: null, ep: 523, parentKey: null,
}];

function shape(raw: Record<string, unknown>) {
  return shapePatreonEpisodes([raw], parent)[0];
}

describe("a stated Panel: line", () => {
  it("is used verbatim when the description carries one", () => {
    const e = shape({
      guid: "1", title: "Some Patreon Run #4",
      panel: ["Kara Szamborski", "Tia Vasiliou"],
    });
    expect(e.people).toEqual(["Kara Szamborski", "Tia Vasiliou"]);
  });

  it("outranks the parent episode's borrowed panel", () => {
    const borrowed = shape({
      guid: "2", title: "Post-Credits: The Homie Batman",
      parentTitle: "The Homie Batman", panel: [],
    });
    expect(borrowed.people).toEqual(["Mike Rapin", "Brian Murray"]);

    const stated = shape({
      guid: "3", title: "Post-Credits: The Homie Batman",
      parentTitle: "The Homie Batman", panel: ["Kait Lamphere"],
    });
    expect(stated.people).toEqual(["Kait Lamphere"]);
  });

  it("still folds a first-name spelling onto the regular it means", () => {
    // ALIASES is the single source for this; a `Panel: Nick` line must not mint a second
    // person beside Nick White, who would get their own page and their own percentage.
    const e = shape({ guid: "4", title: "x", panel: ["Nick", "Paul"] });
    expect(e.people).toEqual(["Nick White", "Paul Jaissle"]);
  });

  it("leaves an episode with neither a panel line nor a parent saying nothing", () => {
    const e = shape({ guid: "5", title: "Saga of Saga: Issue 9" });
    expect(e.people).toEqual([]);
  });
});

/**
 * Episode numbers used to be the episode's position in the feed, which was wrong in both
 * directions: the feed opens at episode 85, so the oldest came out 84 low, and 162 minisodes,
 * interviews and bonuses that never consumed a number pushed the newest 43 high. "400
 * Episodes of FOMO" was labelled EP. 435. They are now the show's own numbers, attached at
 * build time, and an episode that never had one is absent rather than invented.
 */
describe("episode numbering", () => {
  const eps = [
    { key: "a", ep: 400, title: "400 Episodes of FOMO" },
    { key: "b", ep: null, title: "Minisode 31" },
    { key: "c", ep: 401, title: "the next one" },
  ] as unknown as EpisodeCore[];

  it("returns the show's own number, not a feed position", () => {
    const nos = feedNumbers(eps);
    expect(nos.get("a")).toBe(400);
    expect(nos.get("c")).toBe(401);
  });

  it("omits episodes that never had a number rather than inventing one", () => {
    const nos = feedNumbers(eps);
    expect(nos.has("b")).toBe(false);
    expect(nos.size).toBe(2);
  });
});
