import type { EpisodeCore } from "./types";
import { isRoster } from "./roster";

export interface PersonStats {
  name: string;
  episodes: number;
  first: string | null;   // "yyyy-mm-dd", null when none of their episodes carry a date
  latest: string | null;
  keys: string[];         // episode keys, newest first
}

let cachedFor: EpisodeCore[] | null = null;
let cached = new Map<string, PersonStats>();

/** Everyone who has sat at the table, counted from the real episode list. */
export function peopleStats(episodes: EpisodeCore[]): Map<string, PersonStats> {
  if (cachedFor === episodes) return cached;
  const by = new Map<string, PersonStats>();
  const sorted = episodes.slice().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  for (const e of sorted) {
    for (const name of e.people) {
      let p = by.get(name);
      if (!p) by.set(name, (p = { name, episodes: 0, first: null, latest: null, keys: [] }));
      p.episodes++;
      p.keys.push(e.key);
      if (e.date) {
        if (!p.latest || e.date > p.latest) p.latest = e.date;
        if (!p.first || e.date < p.first) p.first = e.date;
      }
    }
  }
  cached = by;
  cachedFor = episodes;
  return cached;
}

/** Share of the whole run, rounded once so every surface shows the same number. */
export function sharePct(episodes: number, total: number): number {
  return total ? Math.round((episodes / total) * 100) : 0;
}

export function guestNames(episodes: EpisodeCore[]): string[] {
  return [...peopleStats(episodes).keys()].filter(n => !isRoster(n)).sort((a, b) => a.localeCompare(b));
}
