// Shared data shapes for the IRCB search app.
// Imported via JSDoc: /** @typedef {import("./types").Episode} Episode */

/** A single comic mention within an episode (one row of comics.json). */
export interface Comic {
  comic: string;
  show_id: string;
  segment?: string;
  timestamp?: string;
  direct_url?: string;
}

/** A podcast episode (one row of episodes.json). */
export interface Episode {
  show_id: string;
  title?: string;
  date?: string;
  /** Comma-separated panelist/guest names. */
  people?: string;
  /** Comma-separated keyword tags. */
  keywords?: string;
  simplecast_url?: string;
  player_id?: string | null;
  summary?: string;
}

/** A canonical panelist roster entry. */
export interface Panelist {
  name: string;
  display: string;
  photo: string;
  aliases?: string[];
  tagline?: string;
}

// Test-helper globals exposed by app.js after data load
declare global {
  interface Window {
    latestEpisodeComics: string[];
    comicEpisodes: Record<string, Set<string>>;
  }
}
