export interface EpisodeCore {
  key: string;                 // show_id, else "x:" + date + "|" + title slug
  showId: string | null;
  title: string;
  date: string | null;         // "yyyy-mm-dd"; null when the source date is missing or pre-1980
  people: string[];            // trimmed full names, aliases resolved (Danny→Daniel Martinez)
  runtimeSecs: number | null;
  artwork: string | null;
  enclosure: string | null;
  playerId: string | null;
  simplecastUrl: string | null;
  patreonUrl: string | null;
}

export interface EpisodeDetail { key: string; summary: string | null; keywords: string[] }

export interface Mention { comic: string; series: string; epKey: string; segment: string | null; secs: number | null }

export interface Stats { episodes: number; mentions: number; series: number; indexedEpisodes: number; people: number }

export interface CoreData { stats: Stats; episodes: EpisodeCore[] }
