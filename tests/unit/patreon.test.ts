import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { CoreData } from "../../src/data/types";

/**
 * `data/patreon-series.json` is seven hand-written pattern → URL entries, and it is the only
 * thing that turns a Patreon-only episode into a link. It covers all 146 today. Nothing tells
 * anyone when it stops covering them.
 *
 * An episode that never appeared in the Simplecast sheet has no date — that is what the Wall's
 * legend counts, and it is exactly the shape of a Patreon spin-off. So the day a new series
 * launches, its episodes arrive dateless and unmatched, get no "Listen on Patreon" link, and
 * the site quietly says nothing about where to hear them. This is the thing that notices.
 *
 * It reads the built chunk on purpose: the pattern list is only wrong relative to real data,
 * so a fixture could not fail for the reason this exists.
 */

const PATH = "public/d/core.json";

describe("the Patreon shelf", () => {
  it("has a collection link for every episode that lives only on Patreon", () => {
    expect(existsSync(PATH), `${PATH} is generated — run \`npm run build\` first`).toBe(true);
    const core = JSON.parse(readFileSync(PATH, "utf8")) as CoreData;

    /* One record carries no title at all, and no pattern can ever match nothing. It is a known
       hole in the source data rather than a missing series, so it is excluded by name here —
       if a second one shows up, that is worth hearing about. */
    const titleless = core.episodes.filter(e => !e.date && !e.title);
    expect(titleless.length, "more than one undated episode has no title").toBeLessThanOrEqual(1);

    const unlinked = core.episodes
      .filter(e => !e.date && e.title && !e.patreonUrl)
      .map(e => e.title);

    expect(unlinked, "add the series to data/patreon-series.json").toEqual([]);
  });

  it("every pattern still matches something, so a renamed series is noticed too", () => {
    const core = JSON.parse(readFileSync(PATH, "utf8")) as CoreData;
    const dead = core.patreonSeries
      .filter(s => !core.episodes.some(e => e.title?.includes(s.pattern)))
      .map(s => s.pattern);

    /* The other direction, and the quieter one: a pattern that matches nothing is either a
       series that was renamed upstream or a typo, and either way some episodes lost their
       link without anything going obviously wrong. */
    expect(dead, "these patterns no longer match any episode").toEqual([]);
  });
});
