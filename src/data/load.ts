import type { CoreData, EpisodeDetail, Mention } from "./types";

// core.json rides the first paint; the other two are only fetched when a route needs them.
let corePromise: Promise<CoreData> | null = null;
let mentionsPromise: Promise<Mention[]> | null = null;
let detailsPromise: Promise<Map<string, EpisodeDetail>> | null = null;

async function json<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export function core(): Promise<CoreData> {
  return (corePromise ??= json<CoreData>("d/core.json"));
}

export function mentions(): Promise<Mention[]> {
  return (mentionsPromise ??= json<Mention[]>("d/mentions.json"));
}

export function details(): Promise<Map<string, EpisodeDetail>> {
  return (detailsPromise ??= json<EpisodeDetail[]>("d/detail.json")
    .then(list => new Map(list.map(d => [d.key, d]))));
}
