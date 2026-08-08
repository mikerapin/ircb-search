import { describe, it, expect } from "vitest";
import { shapeEpisodes, shapeDetails, shapeMentions, buildStats, attachMentionCounts, tsToSeconds } from "../../src/data/shape";
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
  });
});
