import { describe, expect, it } from "vitest";

import { attachTagSeries, shapeTaggedMentions, tagSeriesResolver, TAGGED } from "../../src/data/shape";
import { buildTaxonomy, type TagSeeds } from "../../src/data/tags";
import type { EpisodeCore, EpisodeDetail, Mention } from "../../src/data/types";

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

/**
 * The classification runs inside the build now, against the episodes and mentions it has just
 * shaped. It used to be read from data/tag-taxonomy.json, which made a derived file into an
 * input: a week after the last generator run, six of the newest episode's seven terms named
 * books already on the shelf and not one of them landed. Nothing had gone wrong with the
 * rules — the answer was simply older than the question.
 */
describe("classifying the keywords", () => {
  const seeds: TagSeeds = {
    publishers: ["_comment goes here", "Image Comics"],
    creators: ["Jeff Lemire"],
    noise: ["comics", "podcast"],
    segments: { terms: ["goodreads"] },
    comics: { terms: [] },
    showSeries: { terms: ["Candybar Antlerboy"] },
    showFormat: { terms: ["minisode"] },
    aliases: { "_comment": "x", "wicdiv": "the wicked + the divine", "marvel comics": "marvel" },
  };
  const men: Mention[] = [
    { comic: "Batman #1", series: "Batman", epKey: "a", segment: null, secs: null },
    { comic: "The Wicked + The Divine #2", series: "The Wicked + The Divine", epKey: "a", segment: null, secs: null },
  ];
  const eps = [{ key: "a", people: ["Kieron Gillen"] }] as unknown as EpisodeCore[];
  const detail = (key: string, keywords: string[]): EpisodeDetail => ({ key, summary: null, keywords });

  const tax = buildTaxonomy(
    [detail("a", ["batman", "image comics", "jeff lemire", "comics", "minisode", "eccc"]),
     detail("b", ["wicdiv", "batman", "kieron gillen", "candybar antlerboy"])],
    men, eps, seeds);

  it("types a term the index already shelves as that series", () => {
    expect(tax["batman"]).toMatchObject({ type: "series", series: "Batman", episodes: 2 });
  });

  it("folds an alias onto the term it means, so one run is not two facets", () => {
    // "wicdiv" is not a heading anywhere; the alias is what carries it onto the real one.
    expect(tax["wicdiv"]).toBeUndefined();
    expect(tax["the wicked + the divine"]).toMatchObject({ type: "series" });
  });

  it("drops noise rather than classifying it", () => {
    expect(tax["comics"]).toBeUndefined();
  });

  it("reads publishers and creators off the seed lists, never off the shape of the name", () => {
    expect(tax["image comics"]?.type).toBe("publisher");
    expect(tax["jeff lemire"]?.type).toBe("creator");
    // Nobody listed them, but the show had them at the table, which is the same kind of thing.
    expect(tax["kieron gillen"]?.type).toBe("creator");
  });

  it("separates what an episode was from what was discussed in it", () => {
    expect(tax["minisode"]?.type).toBe("showFormat");
    expect(tax["candybar antlerboy"]?.type).toBe("showSeries");
  });

  it("leaves everything else a topic", () => {
    expect(tax["eccc"]).toMatchObject({ type: "topic", episodes: 1 });
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
