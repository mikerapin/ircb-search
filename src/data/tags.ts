import type { EpisodeCore, EpisodeDetail, Mention } from "./types";
import { clean, seriesKey, yearSensitiveKeys } from "./series";

/**
 * Classify the show's RSS keywords.
 *
 * This used to live in scripts/build-tag-taxonomy.mjs and write data/tag-taxonomy.json, which
 * the build then read back. That made a derived file into an input, and it went stale the way
 * every derived file left lying around does: a week after the taxonomy was generated, six of
 * the newest episode's seven terms named books already on the shelf and none of them landed,
 * because the classification had been computed before that episode existed.
 *
 * Nothing was ever hand-edited into it — the 261-row review fed data/tag-seeds.json, which is
 * the curated half and is a real input. Regenerating was a clean no-op modulo new episodes. So
 * the build computes this in memory instead, from the same episodes, details and mentions it
 * has already shaped, and the classification cannot be older than the data it describes.
 *
 * Reading it back had a second fault worth naming: the mentions on disk now include the tagged
 * ones this classification produces, so each build fed its own output back in as evidence.
 * In-process, it sees only the logged mentions.
 *
 * Rules in order, first match wins; anything unmatched becomes `topic`:
 *   series     — resolves to a key already in the series index, via the app's own seriesKey()
 *   showSeries — a named IRCB run (Candybar Antlerboy), not a comic
 *   showFormat — what kind of episode it is (minisode), not what was discussed in it
 *   series     — a book confirmed by review that the extraction never logged, resolved to the
 *                one series whose mention strings start with it
 *   franchise  — the same, but spanning several series pages: an episode tagged "godzilla"
 *                did not discuss all seven Godzilla series, so it merges into none of them
 *   publisher  — listed in tag-seeds.json
 *   creator    — listed in tag-seeds.json, or someone the show has had at the table
 *   topic      — everything else
 *
 * The keywords arrive lowercased, so there is no casing signal separating "jeff lemire" from
 * "sweet tooth". A term is a creator because it is on a list, never because it looks like a
 * name. Correct a wrong call in data/tag-seeds.json, never here.
 */

export type TagType =
  | "series" | "franchise" | "publisher" | "creator" | "showSeries" | "showFormat" | "topic";

export interface TagEntry {
  type: TagType;
  episodes: number;
  series?: string;
  spans?: string[];
  review?: string;
}

export interface TagSeeds {
  publishers: string[];
  creators: string[];
  noise: string[];
  segments: { terms: string[] };
  comics: { terms: string[] };
  showSeries: { terms: string[] };
  showFormat: { terms: string[] };
  aliases: Record<string, string>;
}

/** Seed files carry `_comment` keys for the reader; they are notes, not terms. */
const listed = (a: string[] | undefined): Set<string> =>
  new Set((a ?? []).filter(x => !x.startsWith("_")).map(s => s.toLowerCase()));

export function seedAliases(seeds: TagSeeds): Record<string, string> {
  return Object.fromEntries(
    Object.entries(seeds.aliases ?? {}).filter(([k]) => !k.startsWith("_")));
}

/* A hint, deliberately not a rule. Many topic terms appear somewhere inside a comic string,
   but a substring match also catches "annual", "anthology" and "black and white" — format
   words that happen to sit inside a title. Requiring the comic to *start* with the term is how
   a series name actually behaves, and the rest is left for a person to read. Promoting these
   automatically would invent series pages, and a wrong entry is worse than a missing one. */
const FORMAT_WORDS = new Set([
  "annual", "anthology", "anniversary", "biography", "best of", "one shot", "one-shot",
  "black and white", "autumn", "spring", "summer", "winter", "omnibus", "hardcover",
]);

export function buildTaxonomy(
  details: EpisodeDetail[],
  mentions: Mention[],
  episodes: EpisodeCore[],
  seeds: TagSeeds,
): Record<string, TagEntry> {
  const PUBLISHERS = listed(seeds.publishers);
  const CREATORS = listed(seeds.creators);
  const NOISE = listed(seeds.noise);
  const SEGMENTS = listed(seeds.segments?.terms);
  const REVIEWED_COMICS = listed(seeds.comics?.terms);
  const SHOW_SERIES = listed(seeds.showSeries?.terms);
  const SHOW_FORMAT = listed(seeds.showFormat?.terms);
  const ALIASES = seedAliases(seeds);

  /* Everyone the show has actually had at the table. A discussed creator and a guest creator
     are the same kind of thing for a facet, and this list is already curated upstream. */
  for (const e of episodes) for (const p of e.people ?? []) CREATORS.add(p.toLowerCase());

  /* The app's own series identity, so a tag lands on the page it names rather than beside it. */
  const yearKeys = yearSensitiveKeys(mentions.map(m => m.comic));
  const seriesKeys = new Map<string, string>();
  const comicStarts = new Set<string>();
  for (const m of mentions) {
    seriesKeys.set(seriesKey(m.comic, yearKeys), m.series);
    comicStarts.add(clean(m.comic).toLowerCase());
  }

  const episodesOf = new Map<string, Set<string>>();
  for (const d of details) {
    for (const k of d.keywords ?? []) {
      const term = k.trim().toLowerCase();
      if (!term) continue;
      const folded = ALIASES[term] ?? term;
      if (NOISE.has(folded)) continue;
      let seen = episodesOf.get(folded);
      if (!seen) episodesOf.set(folded, (seen = new Set()));
      seen.add(d.key);
    }
  }

  /* Which existing series does a reviewed term name? A reviewed comic is a topic-classified
     term, so by construction it is not itself a series key — it is the front of one or more
     comic strings. */
  const seriesPrefixedBy = (term: string): string[] => {
    const hits = new Set<string>();
    for (const m of mentions) {
      if (clean(m.comic).toLowerCase().startsWith(term)) hits.add(m.series);
    }
    return [...hits].sort();
  };

  const classify = (term: string): [TagType, string | null, string[]?] => {
    const key = seriesKey(term, yearKeys);
    const known = seriesKeys.get(key);
    if (known !== undefined) return ["series", known];
    if (SHOW_SERIES.has(term)) return ["showSeries", null];
    if (SHOW_FORMAT.has(term)) return ["showFormat", null];
    if (REVIEWED_COMICS.has(term)) {
      const hits = seriesPrefixedBy(term);
      if (hits.length === 1) return ["series", hits[0] ?? null];
      if (hits.length > 1) return ["franchise", null, hits];
      return ["series", null];
    }
    if (SEGMENTS.has(term)) return ["topic", null];
    if (PUBLISHERS.has(term)) return ["publisher", null];
    if (CREATORS.has(term)) return ["creator", null];
    return ["topic", null];
  };

  const looksLikeSeries = (term: string): boolean => {
    if (term.length < 8 || FORMAT_WORDS.has(term) || SEGMENTS.has(term)) return false;
    for (const c of comicStarts) if (c.startsWith(term)) return true;
    return false;
  };

  const taxonomy: Record<string, TagEntry> = {};
  for (const [term, keys] of [...episodesOf].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [type, seriesName, spans] = classify(term);
    const hint = type === "topic" && looksLikeSeries(term);
    taxonomy[term] = {
      type,
      episodes: keys.size,
      ...(seriesName ? { series: seriesName } : {}),
      ...(spans ? { spans } : {}),
      ...(hint ? { review: "may be a comic — a mention string starts with this" } : {}),
    };
  }
  return taxonomy;
}
