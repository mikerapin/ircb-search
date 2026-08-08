import { it, expect, describe } from "vitest";
import { runSearch, jumpable, type SearchData } from "../../src/search/engine";
import type { EpisodeCore, Mention } from "../../src/data/types";

const ep = (over: Partial<EpisodeCore> & { key: string }): EpisodeCore => ({
  showId: over.key, title: "", date: null, people: [], runtimeSecs: 3600, mentionCount: 0,
  artwork: null, enclosure: "http://x/a.mp3", playerId: null, simplecastUrl: null, patreonUrl: null,
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
  core: { stats: { episodes: 3, mentions: 5, series: 4, indexedEpisodes: 3, people: 4 }, episodes },
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

describe("jumpable", () => {
  it("refuses stamps we cannot honour", () => {
    const byKey = new Map(episodes.map(e => [e.key, e]));
    expect(jumpable(mentions[0]!, byKey.get("a"))).toBe(true);
    expect(jumpable(mentions[1]!, byKey.get("c"))).toBe(false); // no audio
    expect(jumpable(mentions[2]!, byKey.get("b"))).toBe(false); // no minute logged
    expect(jumpable(mentions[4]!, byKey.get("a"))).toBe(false); // past the runtime
  });
});
