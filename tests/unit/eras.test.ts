import { describe, expect, it } from "vitest";
import { eraCounts } from "../../src/views/about";
import type { EpisodeCore } from "../../src/data/types";

/**
 * The three eras on About the Data have to partition the archive. They did not: the back
 * catalogue was `!showId && date` while the shelf was `patreonUrl`, which double-counted the
 * one dated Patreon record and orphaned the one record with no showId, no date and no
 * Patreon URL.
 *
 * **The reason this needs a fixture and not a page assertion:** on the live data both
 * definitions return the identical 84. The double-count and the orphan cancel in the count
 * exactly as they cancel in the sum, so every rendered figure agrees under either rule and
 * a Playwright check on the page cannot fail. The fixture below carries *two* orphans
 * against one double-count, so the errors no longer cancel and the broken rule goes red.
 */
const ep = (o: Partial<EpisodeCore>): EpisodeCore => ({
  key: o.key ?? "k", showId: null, title: "t", date: null, people: [], runtimeSecs: null,
  mentionCount: 0, artwork: null, enclosure: null, playerId: null, simplecastUrl: null,
  patreonUrl: null, ...o,
});

const FIXTURE: EpisodeCore[] = [
  ep({ key: "feed", showId: "abc", date: "2024-01-01" }),          // the feed era
  ep({ key: "back", date: "2015-01-01" }),                         // plain back catalogue
  ep({ key: "trap-double", date: "2016-01-20", patreonUrl: "p" }), // dated AND Patreon
  ep({ key: "trap-orphan-1" }),                                    // no showId, date or URL
  ep({ key: "trap-orphan-2" }),                                    // ...and a second one
  ep({ key: "shelf", patreonUrl: "p" }),                           // undated Patreon bonus
];

describe("eraCounts", () => {
  it("partitions the archive — the three buckets sum to the record count", () => {
    const c = eraCounts(FIXTURE);
    expect(c.feed + c.backCatalogue + c.patreonShelf).toBe(FIXTURE.length);
  });

  it("files a dated Patreon record on the shelf only, never in both", () => {
    // The old rule counted `trap-double` as back catalogue *and* as shelf.
    const c = eraCounts(FIXTURE);
    expect(c.backCatalogue).toBe(3);   // back, trap-orphan-1, trap-orphan-2
    expect(c.patreonShelf).toBe(2);    // trap-double, shelf
  });

  it("keeps a record with no showId, no date and no Patreon URL — it fell through all three", () => {
    const orphansOnly = [ep({ key: "o1" }), ep({ key: "o2" })];
    const c = eraCounts(orphansOnly);
    expect(c.feed + c.backCatalogue + c.patreonShelf).toBe(2);
    expect(c.backCatalogue).toBe(2);
  });

  it("reports how many of the back catalogue carry a date, since not all do", () => {
    // The page says "N records never reached the feed… M of them carry air dates".
    // M is not N: the untitled record is in the bucket without one.
    const c = eraCounts(FIXTURE);
    expect(c.backCatalogue).toBe(3);
    expect(c.backCatalogueDated).toBe(1);
  });

  it("counts an empty archive as three empty buckets, not as NaN", () => {
    expect(eraCounts([])).toEqual({ feed: 0, backCatalogue: 0, backCatalogueDated: 0, patreonShelf: 0 });
  });
});
