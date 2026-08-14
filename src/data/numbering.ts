import type { EpisodeCore } from "./types";

let cachedFor: EpisodeCore[] | null = null;
let cached = new Map<string, number>();

/**
 * Episode numbers, keyed by episode key.
 *
 * These are the show's own numbers, attached at build time — not a position in the feed.
 * Counting feed items was wrong in both directions: the feed opens at episode 85, so early
 * episodes came out 84 too low, and it carries 162 minisodes, interviews, bonuses and annuals
 * that never consumed a number, so later ones came out as much as 44 too high. The episode
 * titled "400 Episodes of FOMO" was labelled EP. 435 and "500 Episodes and We've Finally
 * Figured Out Comic Books" was labelled EP. 543.
 *
 * 162 feed episodes carry no number at all and are absent from this map on purpose. They are
 * bonus content — the show numbers its minisodes in a separate run — and giving them one is
 * the mistake this replaced.
 */
/**
 * The most recent episode that has a number, with it. Null before any data has a date.
 *
 * "Most recent" has to mean most recent *numbered*: the archive holds Patreon records and a
 * pre-feed back catalogue that never had a number, and one of those sorting first would make
 * the masthead name an episode nobody can call by a number.
 */
export function newestNumbered(
  episodes: EpisodeCore[],
): { episode: EpisodeCore; no: number } | null {
  const nos = feedNumbers(episodes);
  let best: EpisodeCore | null = null;
  for (const e of episodes) {
    if (e.date && nos.has(e.key) && (!best?.date || e.date > best.date)) best = e;
  }
  const no = best ? nos.get(best.key) : undefined;
  return best && no !== undefined ? { episode: best, no } : null;
}

export function feedNumbers(episodes: EpisodeCore[]): Map<string, number> {
  if (cachedFor === episodes) return cached;
  cached = new Map(
    episodes.filter(e => e.ep != null).map(e => [e.key, e.ep as number]),
  );
  cachedFor = episodes;
  return cached;
}
