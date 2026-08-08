import type { EpisodeCore, EpisodeDetail, Mention, Stats } from "./types";
import { clean, normalizeSeries, pickDisplayNames, seriesKey } from "./series";

/* The roster spells one regular "Daniel"; the feed spells him "Danny".
   One person, two strings — fold them or he shows up as his own guest. */
export const ALIASES: Record<string, string> = { "Danny Martinez": "Daniel Martinez" };

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

function people(v: unknown): string[] {
  return String(v ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(n => ALIASES[n] ?? n);
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
    };
  });
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
     Visions" and "Star Wars Visions" are two series pages splitting one run between them. */
  const display = pickDisplayNames(out.map(m => m.comic));
  for (const m of out) m.series = display.get(seriesKey(m.comic)) ?? m.series;

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
    indexedEpisodes: new Set(mentions.map(m => m.epKey)).size,
    people: names.size,
  };
}
