import { describe, expect, it } from "vitest";

import { attachTagSeries, shapeTaggedMentions, tagSeriesResolver, TAGGED } from "../../src/data/shape";
import type { EpisodeDetail, Mention } from "../../src/data/types";

/**
 * The RSS keywords are an index of what the show *tagged*, not of what it discussed. Measured
 * when this shipped, `batman` was tagged on 23 episodes and named in the comic rows of 111, so
 * a tag is worth adding to a shelf and worth nothing as a claim about coverage. Two rules keep
 * it to the first job: a tag may only join a run the index already holds, and it never brings
 * a minute, because a keyword records that a book came up and nothing about when.
 */
const men: Mention[] = [
  { comic: "Batman #1", series: "Batman", epKey: "a", segment: "Timestamps", secs: 90 },
  { comic: "Palestine by Joe Sacco", series: "Palestine by Joe Sacco", epKey: "b", segment: null, secs: null },
];

const taxonomy = {
  "batman": { type: "series", series: "Batman" },
  "palestine": { type: "series", series: "Palestine by Joe Sacco" },
  "wicdiv": { type: "series", series: "The Wicked + The Divine" },  // no such page here
  "image comics": { type: "publisher" },
  "kickstarter": { type: "topic" },
};
const aliases = { "the batman": "batman" };

const detail = (key: string, keywords: string[]): EpisodeDetail => ({ key, summary: null, keywords });
const resolve = tagSeriesResolver(taxonomy, aliases, men);

describe("resolving a keyword to a shelf", () => {
  it("takes only terms the taxonomy typed as a series", () => {
    expect(resolve("batman")).toBe("Batman");
    expect(resolve("image comics")).toBeNull();
    expect(resolve("kickstarter")).toBeNull();
  });

  it("refuses a series the index does not already hold, rather than opening one", () => {
    // The whole point: one stray keyword must not mint a page with a single episode on it.
    expect(resolve("wicdiv")).toBeNull();
  });

  it("folds an alias and ignores case and padding", () => {
    expect(resolve("the batman")).toBe("Batman");
    expect(resolve("  BATMAN ")).toBe("Batman");
  });
});

describe("tag-derived mentions", () => {
  it("adds the episode to the run, with no minute and a label saying where it came from", () => {
    const [m, ...rest] = shapeTaggedMentions([detail("z", ["batman"])], resolve, men);
    expect(rest).toEqual([]);
    expect(m).toEqual({ comic: "Batman", series: "Batman", epKey: "z", segment: TAGGED, secs: null });
  });

  it("leaves an episode alone when its comic rows already name that run", () => {
    // Episode "a" logged Batman at 1:30. A weaker copy carrying no minute would sit beside the
    // real row in the checklist and be offered as a second, unjumpable sighting of one book.
    expect(shapeTaggedMentions([detail("a", ["batman"])], resolve, men)).toEqual([]);
  });

  it("adds one row when two keywords fold onto the same run", () => {
    const out = shapeTaggedMentions([detail("z", ["batman", "the batman"])], resolve, men);
    expect(out).toHaveLength(1);
  });
});

describe("tag chips", () => {
  it("records only the terms that do not already spell their own heading", () => {
    const [d] = attachTagSeries([detail("z", ["batman", "palestine", "kickstarter"])], resolve);
    // `batman` is Batman in the show's casing, and a tagged mention guarantees the episode
    // carries that heading, so the view finds it without the build shipping a lookup.
    expect(d?.keywordSeries).toEqual({ "palestine": "Palestine by Joe Sacco" });
  });

  it("leaves the field off entirely when nothing needs it", () => {
    const [d] = attachTagSeries([detail("z", ["batman", "image comics"])], resolve);
    expect(d?.keywordSeries).toBeUndefined();
  });
});
