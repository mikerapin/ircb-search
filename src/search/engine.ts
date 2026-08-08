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

  let mentions: Mention[] = t ? idx.men.search(t, { limit: 400 }).map(r => r.item) : [];
  let episodes: EpisodeCore[] = t
    ? idx.eps.search(t, { limit: 100 }).map(r => byKey.get(r.item.key)).filter((e): e is EpisodeCore => !!e)
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

  if (query.sort === "oldest") episodes = episodes.slice().sort(byDate(1));
  else if (query.sort === "recent" || !t) episodes = episodes.slice().sort(byDate(-1));

  const playable = mentions.filter(m => jumpable(m, byKey.get(m.epKey))).length;
  return { mentions: mentions.slice(0, SEARCH_CAP), all: mentions, mentionTotal: mentions.length, episodes, playable };
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
