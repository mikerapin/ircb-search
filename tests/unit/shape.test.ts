import { describe, it, expect } from "vitest";
import { shapeEpisodes, shapeDetails, shapeMentions, buildStats, attachMentionCounts, tsToSeconds, dropUnreleased } from "../../src/data/shape";
import type { EpisodeCore } from "../../src/data/types";
import epsRaw from "./fixtures/episodes.sample.json";
import comicsRaw from "./fixtures/comics.sample.json";

const eps = shapeEpisodes(epsRaw);

describe("shapeEpisodes", () => {
  it("keeps every source record", () => {
    expect(eps.length).toBe(epsRaw.length);
  });

  it("reads dates in both source formats", () => {
    // The export emits epoch-ms ints for most rows and RFC-2822 strings for recent ones.
    expect(eps.find(e => e.title === "Do Not Smell Me. You Will Not Be Pleased.")?.date).toBe("2026-08-05");
    expect(eps.find(e => e.title === "The Politics in Comic Books")?.date).toBe("2016-09-21");
  });

  it("nulls missing dates", () => {
    const undated = eps.filter(e => e.date === null);
    expect(undated.length).toBeGreaterThan(0);
  });

  it("nulls pre-1980 dates", () => {
    // Defensive: no such record ships today, but an epoch-zero date must not become "1970-01-01".
    const [bogus] = shapeEpisodes([{ show_id: "z", title: "Epoch", date: 0, people: "" }]);
    expect(bogus?.date).toBeNull();
  });

  it("synthesizes unique keys for null show_id", () => {
    const noId = eps.filter(e => e.showId === null);
    expect(noId.length).toBeGreaterThan(0);
    expect(new Set(noId.map(e => e.key)).size).toBe(noId.length);
    for (const e of noId) expect(e.key.startsWith("x:")).toBe(true);
  });

  it("survives a null title and null people", () => {
    const blank = eps.find(e => e.title === "");
    expect(blank).toBeDefined();
    expect(blank?.people).toEqual([]);
  });

  it("resolves Danny → Daniel Martinez", () => {
    expect(eps.some(e => e.people.includes("Danny Martinez"))).toBe(false);
    expect(eps.some(e => e.people.includes("Daniel Martinez"))).toBe(true);
  });

  it("folds every short-name spelling to the regular", () => {
    const [e] = shapeEpisodes([{ show_id: "al", title: "T", date: 1600000000000, people: "Nick, Paul, Kate" }]);
    expect(e?.people).toEqual(["Nick White", "Paul Jaissle", "Kate Skocelas"]);
  });

  it("credits a person once when both spellings appear on one episode", () => {
    // peopleStats counts per entry, so a duplicate would double their episode count.
    const [e] = shapeEpisodes([{ show_id: "d", title: "T", date: 1600000000000, people: "Nick, Nick White" }]);
    expect(e?.people).toEqual(["Nick White"]);
  });

  it("rounds float runtimes to whole seconds", () => {
    const withRuntime = eps.filter(e => e.runtimeSecs !== null);
    expect(withRuntime.length).toBeGreaterThan(0);
    for (const e of withRuntime) expect(Number.isInteger(e.runtimeSecs)).toBe(true);
  });
});

describe("tsToSeconds", () => {
  it("parses h:mm:ss and mm:ss", () => {
    expect(tsToSeconds("1:02:33")).toBe(3753);
    expect(tsToSeconds("33:00")).toBe(1980);
    expect(tsToSeconds("garbage")).toBeNull();
    expect(tsToSeconds(null)).toBeNull();
    expect(tsToSeconds("00:00:00")).toBeNull();
  });
});

describe("shapeMentions", () => {
  const men = shapeMentions(comicsRaw, eps);

  it("resolves epKey and drops orphans", () => {
    expect(men.length).toBeGreaterThan(0);
    expect(men.length).toBeLessThan(comicsRaw.length);
    for (const m of men) expect(eps.some(e => e.key === m.epKey)).toBe(true);
  });

  it("nulls unusable timestamps and normalizes series", () => {
    expect(men.some(m => m.secs === null)).toBe(true);
    expect(men.find(m => m.comic === "Batman #50")?.series).toBe("Batman");
    expect(men.find(m => m.comic === "Saga, Vol. 2")?.series).toBe("Saga");
  });

  it("drops generic segment labels", () => {
    expect(men.some(m => m.segment === "Timestamps")).toBe(false);
  });

  it("gives punctuation variants one shared series name", () => {
    const raw = [
      { comic: "Star Wars: Visions #1", show_id: "s", timestamp: "00:01:00" },
      { comic: "Star Wars: Visions #2", show_id: "s", timestamp: "00:02:00" },
      { comic: "Star Wars Visions", show_id: "s", timestamp: "00:03:00" },
      { comic: "Monsters", show_id: "s", timestamp: "00:04:00" },
      { comic: "Monster", show_id: "s", timestamp: "00:05:00" },
    ];
    const epsOne = shapeEpisodes([{ show_id: "s", title: "T", date: 1600000000000, people: "" }]);
    const out = shapeMentions(raw, epsOne);
    const names = out.map(m => m.series);
    expect(names.filter(n => n.toLowerCase().includes("visions"))).toEqual(
      ["Star Wars: Visions", "Star Wars: Visions", "Star Wars: Visions"]);
    // ...but singular and plural stay two different books.
    expect(new Set(names).size).toBe(3);
  });
});

describe("attachMentionCounts", () => {
  it("counts per episode and totals to the mention count", () => {
    const fresh = shapeEpisodes(epsRaw);
    const men = shapeMentions(comicsRaw, fresh);
    attachMentionCounts(fresh, men);
    expect(fresh.reduce((n, e) => n + e.mentionCount, 0)).toBe(men.length);
    const indexed = fresh.filter(e => e.mentionCount > 0);
    expect(indexed.length).toBe(new Set(men.map(m => m.epKey)).size);
  });
});

describe("shapeDetails / buildStats", () => {
  it("splits keywords and counts honestly", () => {
    const det = shapeDetails(epsRaw);
    expect(det.length).toBe(epsRaw.length);
    expect(det.some(d => d.keywords.length > 0)).toBe(true);

    const men = shapeMentions(comicsRaw, eps);
    const stats = buildStats(eps, men);
    expect(stats.episodes).toBe(eps.length);
    expect(stats.mentions).toBe(men.length);
    expect(stats.indexedEpisodes).toBe(new Set(men.map(m => m.epKey)).size);
    expect(stats.series).toBe(new Set(men.map(m => m.series)).size);
    expect(stats.uniqueComics).toBe(new Set(men.map(m => m.comic)).size);
    expect(stats.uniqueComics).toBeGreaterThanOrEqual(stats.series);
  });
});

/**
 * A post-credits segment carries no panel, no comics and no minutes. Alone on the site it is
 * just the title of an episode nobody can hear yet, which is the show spoiling its own drop.
 *
 * Both cases below happened to "Post Credits: Everywhere Bagel (ft. Matt Burbridge)" in the
 * same week. The first was already handled; the second shipped.
 */
describe("dropUnreleased", () => {
  const ep = (over: Partial<EpisodeCore>): EpisodeCore => ({
    key: "k", showId: null, title: "", date: "2026-08-11", people: [], runtimeSecs: null,
    mentionCount: 0, artwork: null, enclosure: null, playerId: null, simplecastUrl: null,
    patreonUrl: null, ep: null, parentKey: null, ...over,
  });

  it("holds the pair that reached Patreon before the public feed", () => {
    const kept = dropUnreleased([
      ep({ key: "p:1", title: "Post Credits: Everywhere Bagel (ft. Matt Burbridge)" }),
      ep({ key: "p:2", title: "Everywhere Bagel (ft. Matt Burbridge)" }),
      ep({ key: "p:3", title: "Saga of Saga #37" }),
    ]);
    expect(kept.map(e => e.key)).toEqual(["p:3"]);
  });

  it("holds a segment whose parent has not resolved, with no sibling left to tell on it", () => {
    // Wednesday: fetch_patreon.py has stopped treating the ad-free mirror as Patreon-only, so
    // the sibling is gone — but data/episodes.json has no row for the episode yet, so
    // parentKey is still null. Nothing here can see the parent, so the segment waits.
    const kept = dropUnreleased([
      ep({ key: "p:1", title: "Post Credits: Everywhere Bagel (ft. Matt Burbridge)" }),
      ep({ key: "p:3", title: "Saga of Saga #37" }),
    ]);
    expect(kept.map(e => e.key)).toEqual(["p:3"]);
  });

  it("keeps a segment once its parent resolves, and never touches a Patreon-only run", () => {
    const kept = dropUnreleased([
      ep({ key: "p:1", title: "Post-Credits: The Homie Batman", parentKey: "abc" }),
      ep({ key: "p:3", title: "Saga of Saga #37" }),
    ]);
    expect(kept.map(e => e.key)).toEqual(["p:1", "p:3"]);
  });
});
