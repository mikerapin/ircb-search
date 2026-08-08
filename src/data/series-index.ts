import type { Mention } from "./types";

export interface SeriesRow { name: string; mentions: number; episodes: number }

let cachedFor: Mention[] | null = null;
let cached: SeriesRow[] = [];

/** Every series with its honest mention and episode counts, most-discussed first. */
export function seriesRows(mentions: Mention[]): SeriesRow[] {
  if (cachedFor === mentions) return cached;
  const by = new Map<string, { mentions: number; eps: Set<string> }>();
  for (const m of mentions) {
    let row = by.get(m.series);
    if (!row) by.set(m.series, (row = { mentions: 0, eps: new Set() }));
    row.mentions++;
    row.eps.add(m.epKey);
  }
  cached = [...by].map(([name, r]) => ({ name, mentions: r.mentions, episodes: r.eps.size }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
  cachedFor = mentions;
  return cached;
}
