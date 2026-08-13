import { it, expect, describe } from "vitest";
import { runSearch, jumpable, type SearchData } from "../../src/search/engine";
import type { EpisodeCore, Mention } from "../../src/data/types";

const ep = (over: Partial<EpisodeCore> & { key: string }): EpisodeCore => ({
  showId: over.key, title: "", date: null, people: [], runtimeSecs: 3600, mentionCount: 0,
  artwork: null, enclosure: "http://x/a.mp3", simplecastUrl: null, patreonUrl: null,
  ep: null, parentKey: null,
  ...over,
});

const episodes: EpisodeCore[] = [
  ep({ key: "a", title: "Saga Night", date: "2024-01-10", people: ["Kara Szamborski", "Ed Brubaker"] }),
  ep({ key: "b", title: "Quiet Panel", date: "2023-05-02", people: ["Daniel Martinez", "Mike Rapin"] }),
  ep({ key: "c", title: "Lost Tape", date: null, people: ["Mike Rapin"], enclosure: null }),
];

const mentions: Mention[] = [
  { comic: "Saga #1", series: "Saga", epKey: "a", segment: null, secs: 120 },
  { comic: "Saga #2", series: "Saga", epKey: "c", segment: null, secs: 300 },   // no enclosure → not playable
  { comic: "Batman #50", series: "Batman", epKey: "b", segment: null, secs: null },
  { comic: "Giant Days", series: "Giant Days", epKey: "b", segment: "Minisode", secs: 900 },
  { comic: "Bone", series: "Bone", epKey: "a", segment: null, secs: 999999 },   // stamp past the runtime
];

const data: SearchData = {
  core: { stats: { episodes: 3, mentions: 5, series: 4, uniqueComics: 4, indexedEpisodes: 3, people: 4 }, episodes, patreonSeries: [] },
  mentions,
  details: new Map([["a", { key: "a", summary: "a night about saga", keywords: ["image comics"] }]]),
};

describe("runSearch", () => {
  it("finds mentions and counts playable honestly", () => {
    const r = runSearch({ q: "saga", who: null, guest: false, sort: "relevance" }, data);
    expect(r.mentionTotal).toBe(2);
    expect(r.playable).toBe(1);   // only the mention on an episode with audio and a sane stamp
  });

  it("panelist filter matches aliases", () => {
    const r = runSearch({ q: "", who: "Daniel Martinez", guest: false, sort: "recent" }, data);
    expect(r.episodes.map(e => e.key)).toEqual(["b"]);
  });

  it("guest filter excludes roster-only panels", () => {
    const r = runSearch({ q: "", who: null, guest: true, sort: "recent" }, data);
    expect(r.episodes.map(e => e.key)).toEqual(["a"]);
  });

  it("recent sort puts null dates last", () => {
    const r = runSearch({ q: "", who: null, guest: false, sort: "recent" }, data);
    expect(r.episodes.at(-1)!.date).toBeNull();
    expect(r.episodes[0]!.key).toBe("a");
  });

  it("oldest sort reverses but still parks null dates last", () => {
    const r = runSearch({ q: "", who: null, guest: false, sort: "oldest" }, data);
    expect(r.episodes[0]!.key).toBe("b");
    expect(r.episodes.at(-1)!.date).toBeNull();
  });

  it("empty query lists every episode, not zero", () => {
    const r = runSearch({ q: "", who: null, guest: false, sort: "recent" }, data);
    expect(r.episodes.length).toBe(3);
    expect(r.mentionTotal).toBe(0);
  });
});

/**
 * Best-match ranking. Fuse alone ranked on text only, so a mention nobody can play could
 * outrank a jumpable one. Text, jumpability and recency now each count for the same, which
 * is the rule Mike asked for: prefer a timestamp, unless the other episode is more recent.
 */
describe("relevance ranking", () => {
  const eps: EpisodeCore[] = [
    ep({ key: "old", title: "Old One", date: "2016-01-01" }),
    ep({ key: "mid", title: "Mid One", date: "2020-01-01" }),
    ep({ key: "new", title: "New One", date: "2026-01-01" }),
  ];
  const build = (mentions: Mention[]): SearchData => ({
    core: { stats: { episodes: 3, mentions: mentions.length, series: 1, uniqueComics: 1, indexedEpisodes: 3, people: 1 }, episodes: eps, patreonSeries: [] },
    mentions,
    details: new Map(),
  });
  const order = (mentions: Mention[]): string[] =>
    runSearch({ q: "batman", who: null, guest: false, sort: "relevance" }, build(mentions))
      .all.map(m => m.epKey);

  it("puts a jumpable mention above a non-jumpable one from the same era", () => {
    // Same text, same episode date. The only difference is whether we can play it.
    const a = ep({ key: "mid" });
    expect(a.key).toBe("mid");
    expect(order([
      { comic: "Batman", series: "Batman", epKey: "mid", segment: null, secs: null },
      { comic: "Batman", series: "Batman", epKey: "mid", segment: null, secs: 120 },
    ])[0]).toBe("mid");
    // ...and specifically the timestamped one is the one in front.
    const r = runSearch({ q: "batman", who: null, guest: false, sort: "relevance" }, build([
      { comic: "Batman", series: "Batman", epKey: "mid", segment: null, secs: null },
      { comic: "Batman", series: "Batman", epKey: "mid", segment: null, secs: 120 },
    ]));
    expect(r.all[0]!.secs).toBe(120);
  });

  it("ranks a jumpable old mention above a non-jumpable middle-aged one", () => {
    expect(order([
      { comic: "Batman", series: "Batman", epKey: "mid", segment: null, secs: null },
      { comic: "Batman", series: "Batman", epKey: "old", segment: null, secs: 120 },
    ])[0]).toBe("old");
  });

  it("lets the newest episode beat a jumpable one from the start of the archive", () => {
    // The "unless an episode is more recent" half of the rule.
    expect(order([
      { comic: "Batman", series: "Batman", epKey: "old", segment: null, secs: 120 },
      { comic: "Batman", series: "Batman", epKey: "new", segment: null, secs: null },
    ])[0]).toBe("new");
  });

  it("a jumpable newest mention outranks everything", () => {
    expect(order([
      { comic: "Batman", series: "Batman", epKey: "old", segment: null, secs: 120 },
      { comic: "Batman", series: "Batman", epKey: "new", segment: null, secs: null },
      { comic: "Batman", series: "Batman", epKey: "new", segment: null, secs: 300 },
    ])[0]).toBe("new");
    const r = runSearch({ q: "batman", who: null, guest: false, sort: "relevance" }, build([
      { comic: "Batman", series: "Batman", epKey: "old", segment: null, secs: 120 },
      { comic: "Batman", series: "Batman", epKey: "new", segment: null, secs: null },
      { comic: "Batman", series: "Batman", epKey: "new", segment: null, secs: 300 },
    ]));
    expect(r.all[0]!.secs).toBe(300);
  });

  it("leaves the date sorts alone — those are the reader's explicit choice", () => {
    const mentions: Mention[] = [
      { comic: "Batman", series: "Batman", epKey: "old", segment: null, secs: 120 },
      { comic: "Batman", series: "Batman", epKey: "new", segment: null, secs: null },
    ];
    const recent = runSearch({ q: "batman", who: null, guest: false, sort: "recent" }, build(mentions));
    expect(recent.all.map(m => m.epKey)).toEqual(["new", "old"]);
    const oldest = runSearch({ q: "batman", who: null, guest: false, sort: "oldest" }, build(mentions));
    expect(oldest.all.map(m => m.epKey)).toEqual(["old", "new"]);
  });

  it("ranks the filtered set, not the raw query hits", () => {
    /* The first cut ranked Fuse's hits directly, which threw the who/guest filters away and
       reported a filtered search's total as the unfiltered one. A Playwright facet-count
       test caught it; this pins it where it's cheap. */
    const filtered: EpisodeCore[] = [
      ep({ key: "kara", date: "2024-01-01", people: ["Kara Szamborski"] }),
      ep({ key: "mike", date: "2025-01-01", people: ["Mike Rapin"] }),
    ];
    const r = runSearch({ q: "batman", who: "Kara Szamborski", guest: false, sort: "relevance" }, {
      core: { stats: { episodes: 2, mentions: 2, series: 1, uniqueComics: 1, indexedEpisodes: 2, people: 2 }, episodes: filtered, patreonSeries: [] },
      mentions: [
        { comic: "Batman", series: "Batman", epKey: "kara", segment: null, secs: 120 },
        { comic: "Batman", series: "Batman", epKey: "mike", segment: null, secs: 120 },
      ],
      details: new Map(),
    });
    expect(r.mentionTotal).toBe(1);
    expect(r.all.map(m => m.epKey)).toEqual(["kara"]);
  });

  it("does not crash when nothing carries a date", () => {
    const undated = [ep({ key: "u1" }), ep({ key: "u2" })];
    const r = runSearch({ q: "batman", who: null, guest: false, sort: "relevance" }, {
      core: { stats: { episodes: 2, mentions: 2, series: 1, uniqueComics: 1, indexedEpisodes: 2, people: 1 }, episodes: undated, patreonSeries: [] },
      mentions: [
        { comic: "Batman", series: "Batman", epKey: "u1", segment: null, secs: null },
        { comic: "Batman", series: "Batman", epKey: "u2", segment: null, secs: 120 },
      ],
      details: new Map(),
    });
    expect(r.all[0]!.epKey).toBe("u2");    // jumpability still decides
  });
});

describe("jumpable", () => {
  it("refuses stamps we cannot honour", () => {
    const byKey = new Map(episodes.map(e => [e.key, e]));
    expect(jumpable(mentions[0]!, byKey.get("a"))).toBe(true);
    expect(jumpable(mentions[1]!, byKey.get("c"))).toBe(false); // no audio
    expect(jumpable(mentions[2]!, byKey.get("b"))).toBe(false); // no minute logged
    expect(jumpable(mentions[4]!, byKey.get("a"))).toBe(false); // past the runtime
  });
});
