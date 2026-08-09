import type { EpisodeCore } from "./types";

let cachedFor: EpisodeCore[] | null = null;
let cached = new Map<string, number>();

/**
 * Feed episode numbers, keyed by episode key.
 *
 * Only the 568 records the feed actually numbers get one. The other 230 are the pre-feed
 * back catalogue and the Patreon shelf, and calling the 798th record "EP. 798" claimed a
 * broadcast number for records that never had one.
 */
export function feedNumbers(episodes: EpisodeCore[]): Map<string, number> {
  if (cachedFor === episodes) return cached;
  const feed = episodes
    .filter(e => e.showId && e.date)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  cached = new Map(feed.map((e, i) => [e.key, i + 1]));
  cachedFor = episodes;
  return cached;
}
