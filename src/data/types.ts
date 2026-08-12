export interface EpisodeCore {
  key: string;                 // show_id, else "x:" + date + "|" + title slug
  showId: string | null;
  title: string;
  date: string | null;         // "yyyy-mm-dd"; null when the source date is missing or pre-1980
  people: string[];            // trimmed full names, aliases resolved (Danny→Daniel Martinez)
  runtimeSecs: number | null;
  mentionCount: number;        // folded in at build time so home can show honest counts
  artwork: string | null;      // without fetching the full mention list
  enclosure: string | null;
  playerId: string | null;
  simplecastUrl: string | null;
  patreonUrl: string | null;
  /* The episode a Patreon post-credits segment belongs to. Those segments are loose chatter
     recorded after a taping, so they carry no mentions of their own — attaching the parent's
     would claim they discussed books they never named. The link is the honest version. */
  parentKey: string | null;
}

export interface EpisodeDetail { key: string; summary: string | null; keywords: string[] }

export interface Mention { comic: string; series: string; epKey: string; segment: string | null; secs: number | null }

export interface Stats {
  episodes: number;
  mentions: number;
  series: number;          // distinct headings after normalization
  uniqueComics: number;    // distinct raw item strings, before normalization
  indexedEpisodes: number;
  people: number;
}

export interface PatreonSeries { pattern: string; name: string; url: string }

export interface CoreData { stats: Stats; episodes: EpisodeCore[]; patreonSeries: PatreonSeries[] }
