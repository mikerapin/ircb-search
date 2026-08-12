import type { EpisodeCore, EpisodeDetail, Mention, PatreonSeries, Stats } from "./types";
import { ALIASES } from "./roster";
import { clean, normalizeSeries, pickDisplayNames, seriesKey, yearSensitiveKeys } from "./series";

/** Segment labels that describe the show's plumbing, not a topic worth surfacing. */
const GENERIC_SEG =
  /^(timestamps?|other|start\s*\/?\s*last week in comics|comics discussed|wrap\s*\/\s*credits|top of (our |the )?pile|minisode|comic picks.*)$/i;

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "nan" ? null : s;
}

/**
 * The export emits dates in three shapes: epoch-milliseconds ints (most rows),
 * RFC-2822 strings (recent rows), and nulls (the 146 records with no air date).
 * Anything before 1980 is a placeholder, not a date.
 */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 1980) return null;
  return d.toISOString().slice(0, 10);
}

/** "HH:MM:SS" or "MM:SS" → seconds. 00:00:00 means "never logged the minute", so: null. */
export function tsToSeconds(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const parts = String(ts).split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs > 0 ? secs : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* Deduped after aliasing, not before: no episode credits both "Nick" and "Nick White"
   today, but one that did would list the same person twice and `peopleStats` counts per
   entry — so the episode, and their whole percentage, would silently double. */
function people(v: unknown): string[] {
  return [...new Set(
    String(v ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(n => ALIASES[n] ?? n),
  )];
}

/* 230 records carry no Simplecast id — the pre-feed back catalogue and the Patreon shelf.
   They are still episodes, so they still need a stable key that survives in a URL. */
function synthKey(date: string | null, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return "x:" + (date ?? "?") + "|" + (slug || "untitled");
}

export function shapeEpisodes(raw: unknown[]): EpisodeCore[] {
  return raw.map(r => {
    const e = rec(r);
    const showId = text(e["show_id"]);
    const title = text(e["title"]) ?? "";
    const date = toIsoDate(e["date"]);
    return {
      key: showId ?? synthKey(date, title),
      showId,
      title,
      date,
      people: people(e["people"]),
      runtimeSecs: num(e["duration_secs"]),
      mentionCount: 0,
      artwork: text(e["artwork_url"]),
      enclosure: text(e["enclosure_url"]),
      playerId: text(e["player_id"]),
      simplecastUrl: text(e["simplecast_url"]),
      patreonUrl: text(e["patreon_url"]),
      parentKey: null,
    };
  });
}

/**
 * The 146 undated, id-less rows in the upstream table are the hand-maintained Patreon shelf.
 * `fetch_patreon.py` reads the same episodes out of the Secret Feed with real dates, artwork
 * and links, and finds 300 rather than 146, so the shelf is replaced rather than merged.
 *
 * The pre-feed back catalogue also has no Simplecast id, but it does have dates, which is
 * what separates the two groups.
 */
export function isPatreonShelfRow(e: EpisodeCore): boolean {
  return e.showId === null && e.date === null;
}

/**
 * Fold a title down to letters and digits for matching across the two feeds.
 *
 * `get_episodes.py` keeps only the half after the pipe, so the table holds "Go Look At A Real
 * Boob" where the Patreon feed names "Episode 399 | Not Legally A Weatherperson". Strip that
 * prefix, then drop punctuation, because the two feeds also disagree about smart quotes.
 */
function titleKey(title: string): string {
  return title
    .replace(/^\s*episode\s+\d+\s*[|:]\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Patreon-only episodes from data/patreon.json, keyed `p:<numeric patreon post id>`. */
export function shapePatreonEpisodes(raw: unknown[], published: EpisodeCore[]): EpisodeCore[] {
  const byTitle = new Map<string, string>();
  for (const e of published) if (e.title) byTitle.set(titleKey(e.title), e.key);

  return raw.map(r => {
    const e = rec(r);
    const parentTitle = text(e["parentTitle"]);
    return {
      key: "p:" + text(e["guid"]),
      showId: null,
      title: text(e["title"]) ?? "",
      date: toIsoDate(e["date"]),
      people: [],                       // the feed credits nobody; the schedule sheet will
      runtimeSecs: num(e["durationSecs"]),
      mentionCount: 0,
      artwork: text(e["artwork"]),
      enclosure: null,                  // per-patron and signed, so it never ships
      playerId: null,
      simplecastUrl: null,
      patreonUrl: text(e["url"]),
      parentKey: parentTitle ? byTitle.get(titleKey(parentTitle)) ?? null : null,
    };
  });
}

/** Punctuation and case folded away, so "Book vs Book" finds "Book vs. Book 11". */
function loose(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Count each promoted Patreon run against the feed, and give it something real to link to.
 *
 * The counts used to be absent and the list hand-maintained, so the house ad named seven runs
 * covering 150 of the 300 Patreon episodes and said nothing about how big any of them were.
 * `data/patreon-series.json` still decides what gets promoted — that is an editorial call —
 * but existence, size and the fallback link are read from the feed.
 */
export function buildPatreonSeries(raw: unknown[], curated: unknown[]): PatreonSeries[] {
  const episodes = raw.map(r => rec(r));
  const out: PatreonSeries[] = [];

  for (const c of curated.map(rec)) {
    const pattern = text(c["pattern"]);
    const name = text(c["name"]);
    if (!pattern || !name) continue;
    const needle = loose(pattern);
    const hits = episodes.filter(e => loose(String(e["title"] ?? "")).includes(needle));
    if (!hits.length) continue;                 // a renamed run, caught by patreon.test.ts

    /* Newest first is how fetch_patreon.py sorts, so the first hit is the latest post. */
    const url = text(c["url"]) ?? text(hits[0]?.["url"]);
    if (url) out.push({ pattern, name, url, episodes: hits.length });
  }

  return out.sort((a, b) => b.episodes - a.episodes || a.name.localeCompare(b.name));
}

/** One mention per comic named on a Patreon episode. No timestamp: none was ever logged. */
export function shapePatreonMentions(raw: unknown[]): Mention[] {
  const out: Mention[] = [];
  for (const r of raw) {
    const e = rec(r);
    const key = "p:" + text(e["guid"]);
    for (const c of Array.isArray(e["comics"]) ? e["comics"] : []) {
      const comic = clean(c);
      if (comic) out.push({ comic, series: normalizeSeries(comic), epKey: key, segment: null, secs: null });
    }
  }
  return out;
}

export function shapeDetails(raw: unknown[]): EpisodeDetail[] {
  return raw.map(r => {
    const e = rec(r);
    const showId = text(e["show_id"]);
    const title = text(e["title"]) ?? "";
    return {
      key: showId ?? synthKey(toIsoDate(e["date"]), title),
      summary: text(e["summary"]),
      keywords: String(e["keywords"] ?? "").split(",").map(s => s.trim()).filter(Boolean),
    };
  });
}

export function shapeMentions(raw: unknown[], episodes: EpisodeCore[]): Mention[] {
  const byShowId = new Map<string, string>();
  for (const e of episodes) if (e.showId) byShowId.set(e.showId, e.key);

  const out: Mention[] = [];
  for (const r of raw) {
    const m = rec(r);
    const showId = text(m["show_id"]);
    const epKey = showId ? byShowId.get(showId) : undefined;
    if (!epKey) continue;                       // a mention we can't attribute is not a mention
    const comic = clean(m["comic"]);
    if (!comic) continue;
    const seg = text(m["segment"]);
    out.push({
      comic,
      series: normalizeSeries(comic),
      epKey,
      segment: seg && !GENERIC_SEG.test(seg) ? seg : null,
      secs: tsToSeconds(text(m["timestamp"])),
    });
  }

  /* Second pass: headings that differ only in punctuation or case are one run, so every
     mention in a group gets that group's most-written spelling. Without this, "Star Wars:
     Visions" and "Star Wars Visions" are two series pages splitting one run between them.
     The year test runs over the whole corpus first, because whether "(2022)" matters can
     only be answered by looking at every other heading for the same title. */
  const comics = out.map(m => m.comic);
  const yearSensitive = yearSensitiveKeys(comics);
  const display = pickDisplayNames(comics, yearSensitive);
  for (const m of out) {
    m.series = display.get(seriesKey(m.comic, yearSensitive)) ?? normalizeSeries(m.comic, yearSensitive);
  }

  return out;
}

/** Fold each episode's mention count onto its record, in place. Returns the same array. */
export function attachMentionCounts(episodes: EpisodeCore[], mentions: Mention[]): EpisodeCore[] {
  const counts = new Map<string, number>();
  for (const m of mentions) counts.set(m.epKey, (counts.get(m.epKey) ?? 0) + 1);
  for (const e of episodes) e.mentionCount = counts.get(e.key) ?? 0;
  return episodes;
}

export function buildStats(episodes: EpisodeCore[], mentions: Mention[]): Stats {
  const names = new Set<string>();
  for (const e of episodes) for (const p of e.people) names.add(p);
  return {
    episodes: episodes.length,
    mentions: mentions.length,
    series: new Set(mentions.map(m => m.series)).size,
    uniqueComics: new Set(mentions.map(m => m.comic)).size,
    indexedEpisodes: new Set(mentions.map(m => m.epKey)).size,
    people: names.size,
  };
}
