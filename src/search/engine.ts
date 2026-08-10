import Fuse from "fuse.js";
import type { CoreData, EpisodeCore, EpisodeDetail, Mention } from "../data/types";
import { isRoster, panelistNames } from "../data/roster";

export interface SearchQuery { q: string; who: string | null; guest: boolean; sort: "relevance" | "recent" | "oldest" }

export interface SearchResults {
  mentions: Mention[];      // capped for render
  all: Mention[];           // uncapped — facet counts must not be capped counts
  mentionTotal: number;     // honest total
  episodes: EpisodeCore[];
  playable: number;         // mentions we can actually jump to
}

export interface SearchData { core: CoreData; mentions: Mention[]; details: Map<string, EpisodeDetail> }

export const SEARCH_CAP = 36;

/* The index is scraped show notes. A 300:19:26 stamp on a 62-minute episode is a typo,
   and a missing minute is not a jump. Don't offer a jump we can't honour. */
export function jumpable(m: Mention, ep: EpisodeCore | undefined): boolean {
  if (m.secs == null || !(m.secs > 0)) return false;
  if (!ep?.enclosure) return false;
  return ep.runtimeSecs == null || m.secs < ep.runtimeSecs;
}

let cache: { data: SearchData; men: Fuse<Mention>; eps: Fuse<EpisodeCore & { keywords: string; summary: string }> } | null = null;

function indexes(data: SearchData) {
  if (cache?.data === data) return cache;
  const men = new Fuse(data.mentions, {
    keys: [{ name: "comic", weight: 0.7 }, { name: "series", weight: 0.3 }],
    threshold: 0.3, ignoreLocation: true,
  });
  const enriched = data.core.episodes.map(e => {
    const d = data.details.get(e.key);
    return { ...e, keywords: (d?.keywords ?? []).join(", "), summary: d?.summary ?? "" };
  });
  const eps = new Fuse(enriched, {
    keys: [{ name: "title", weight: 0.9 }, { name: "keywords", weight: 0.5 },
           { name: "summary", weight: 0.3 }],
    threshold: 0.35, ignoreLocation: true,
  });
  cache = { data, men, eps };
  return cache;
}

export function runSearch(query: SearchQuery, data: SearchData): SearchResults {
  const byKey = new Map(data.core.episodes.map(e => [e.key, e]));
  const t = query.q.trim();
  const idx = indexes(data);

  /* No Fuse `limit` here. It truncates the result array without saving any scoring work —
     Fuse walks the whole corpus either way — but `mentionTotal` and `all` are declared
     above as honest, uncapped figures, and a limit turned "1,204 mentions" into a flat
     "400" for any broad query. SEARCH_CAP on line 79 is the only cap, and it caps what is
     rendered, not what is counted. */
  const hits = t ? idx.men.search(t) : [];
  /* Keyed by object identity, which holds because Fuse hands back the very entries from
     data.mentions. Kept separate from the array so the who/guest filters below can shrink
     the result set and the ranking still knows each survivor's text score. Ranking the raw
     hits instead silently discarded both filters. */
  const textScore = new Map<Mention, number>(hits.map(h => [h.item, h.score ?? 0]));
  let mentions: Mention[] = hits.map(r => r.item);
  let episodes: EpisodeCore[] = t
    ? idx.eps.search(t).map(r => byKey.get(r.item.key)).filter((e): e is EpisodeCore => !!e)
    : data.core.episodes.slice();

  if (query.who) {
    const names = new Set(panelistNames(query.who));
    const on = (e: EpisodeCore | undefined) => !!e?.people.some(p => names.has(p));
    mentions = mentions.filter(m => on(byKey.get(m.epKey)));
    episodes = episodes.filter(on);
  }

  if (query.guest) {
    const hasGuest = (e: EpisodeCore | undefined) => !!e?.people.some(p => !isRoster(p));
    mentions = mentions.filter(m => hasGuest(byKey.get(m.epKey)));
    episodes = episodes.filter(hasGuest);
  }

  const dateOf = (k: string) => byKey.get(k)?.date ?? "";
  if (query.sort === "recent") mentions = mentions.slice().sort((a, b) => dateOf(b.epKey).localeCompare(dateOf(a.epKey)));
  else if (query.sort === "oldest") mentions = mentions.slice().sort((a, b) => dateOf(a.epKey).localeCompare(dateOf(b.epKey)));
  else if (t) mentions = rankByRelevance(mentions, textScore, byKey, data.core.episodes);

  if (query.sort === "oldest") episodes = episodes.slice().sort(byDate(1));
  else if (query.sort === "recent" || !t) episodes = episodes.slice().sort(byDate(-1));

  const playable = mentions.filter(m => jumpable(m, byKey.get(m.epKey))).length;
  return { mentions: mentions.slice(0, SEARCH_CAP), all: mentions, mentionTotal: mentions.length, episodes, playable };
}

/**
 * Best-match order, which is what a query lands on unless the reader picks a date sort.
 *
 * Fuse alone ranked purely on how well the text matched, so a 2017 mention nobody can play
 * outranked a jumpable one from last month. Three signals decide instead, each normalised to
 * 0..1 and each worth exactly the same:
 *
 *   text     how well Fuse matched (1 - score)
 *   jump     whether the play control can actually honour it
 *   recency  where the episode sits between the archive's first and last dated episode
 *
 * Equal weights are the whole design, not a shrug at tuning: being jumpable is worth being
 * the newest episode in the archive, so a jumpable mention beats an equally relevant one
 * from any earlier year, and loses to a newer one. That is the rule as Mike stated it —
 * prefer a timestamp, unless the other episode is more recent.
 *
 * Recency is normalised across the whole archive rather than across the matched set. A query
 * whose hits all land in one year would otherwise have that year stretched over the full
 * range, letting a few weeks outweigh a jump.
 */
function rankByRelevance(
  mentions: Mention[],
  textScore: Map<Mention, number>,
  byKey: Map<string, EpisodeCore>,
  all: EpisodeCore[],
): Mention[] {
  const dates = all.map(e => e.date).filter((d): d is string => !!d).sort();
  const first = dates[0], last = dates.at(-1);
  const span = first && last && first < last ? Date.parse(last) - Date.parse(first) : 0;
  const recency = (d: string | null): number => {
    if (!d || !first || !span) return 0;              // undated records get no lift
    return Math.min(1, Math.max(0, (Date.parse(d) - Date.parse(first)) / span));
  };

  return mentions
    .map((m, i) => {
      const e = byKey.get(m.epKey);
      // Fuse omits `score` when it did not need to rank; a perfect match scores 0.
      const text = 1 - (textScore.get(m) ?? 0);
      return {
        m, i, date: e?.date ?? "",
        score: text + (jumpable(m, e) ? 1 : 0) + recency(e?.date ?? null),
      };
    })
    /* Ties break toward the newer episode, which is what settles the exact boundary the
       equal weights create: a jumpable mention from the first year of the archive scores
       the same as a non-jumpable one from the last, and Mike's rule says the recent one
       wins there. Undated sorts last, since "" precedes every real date. `i` last of all
       keeps the sort total and stable, so a genuine three-way tie holds Fuse's own order. */
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.i - b.i)
    .map(r => r.m);
}

/** dir -1 = newest first. Episodes with no air date always sort last. */
function byDate(dir: number) {
  return (a: EpisodeCore, b: EpisodeCore): number => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -dir : dir;
  };
}
