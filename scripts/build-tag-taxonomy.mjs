/**
 * Seed data/tag-taxonomy.json from the RSS keywords.
 *
 * 506 of the 798 public records carry <itunes:keywords>, 2,000 distinct terms across 3,905
 * uses. Today they are flattened into one comma-joined string that is searchable as free text
 * and linked to nothing. Classifying them turns the ones that repeat into browse axes and the
 * ones that do not into an honest record of what the show has covered once.
 *
 * The measurement that shapes this: 80% of the terms appear on exactly one episode, and only
 * 73 appear on three or more without already being a series page. So `episodes` is written
 * into every entry — a facet of one is a dead end, and the UI needs to be able to see that
 * rather than rendering a page nobody can browse to.
 *
 * Rules in order, first match wins. Anything unmatched becomes `topic`:
 *   series     — resolves to a key already in the series index, via the app's own seriesKey()
 *                rather than a re-implementation, so the two cannot disagree
 *   showSeries — a named IRCB run (Candybar Antlerboy), not a comic
 *   showFormat — what kind of episode it is (minisode), not what was discussed in it
 *   series     — a book Mike confirmed by review that the extraction never logged, resolved
 *                to the one series whose mention strings start with it
 *   franchise  — the same, but spanning several series pages: an episode tagged "godzilla"
 *                did not discuss all seven Godzilla series, so it merges into none of them
 *   publisher  — listed in data/tag-seeds.json
 *   creator    — listed in data/tag-seeds.json, or a known guest from the episode roster
 *   topic      — everything else
 *
 * The keywords arrive lowercased, so there is no casing signal separating "jeff lemire" from
 * "sweet tooth". A term is a creator because it is on a list, never because it looks like a
 * name. Fix a wrong call by adding the term to data/tag-seeds.json and re-running; the
 * taxonomy is generated, so hand-edits to it are lost.
 *
 *   node scripts/build-tag-taxonomy.mjs
 */
import { createServer } from "vite";
import { readFileSync, writeFileSync } from "node:fs";

const vite = await createServer({ server: { middlewareMode: true } });
const series = await vite.ssrLoadModule("/src/data/series.ts");

const seeds = JSON.parse(readFileSync("data/tag-seeds.json", "utf8"));
const core = JSON.parse(readFileSync("public/d/core.json", "utf8"));
const details = JSON.parse(readFileSync("public/d/detail.json", "utf8"));
const mentions = JSON.parse(readFileSync("public/d/mentions.json", "utf8"));

const lower = a => new Set(a.filter(x => !x.startsWith("_")).map(s => s.toLowerCase()));
const PUBLISHERS = lower(seeds.publishers);
const CREATORS = lower(seeds.creators);
const NOISE = lower(seeds.noise);
const SEGMENTS = lower(seeds.segments.terms);
const ALIASES = Object.fromEntries(
  Object.entries(seeds.aliases).filter(([k]) => !k.startsWith("_")));

/* Everyone the show has actually had at the table. A discussed creator and a guest creator
   are the same kind of thing for a facet, and this list is already curated upstream. */
for (const e of core.episodes) for (const p of e.people ?? []) CREATORS.add(p.toLowerCase());

/* The app's own series identity, so a tag lands on the page it names rather than beside it. */
const raw = mentions.map(m => m.comic);
const yearKeys = series.yearSensitiveKeys(raw);
const seriesKeys = new Map();
for (const m of mentions) seriesKeys.set(series.seriesKey(m.comic, yearKeys), m.series);

const episodesOf = new Map();               // term -> Set(episode key)
for (const d of details) {
  const kws = Array.isArray(d.keywords)
    ? d.keywords
    : String(d.keywords ?? "").split(",");
  for (const k of kws) {
    const term = k.trim().toLowerCase();
    if (!term) continue;
    const folded = ALIASES[term] ?? term;
    if (NOISE.has(folded)) continue;
    if (!episodesOf.has(folded)) episodesOf.set(folded, new Set());
    episodesOf.get(folded).add(d.key);
  }
}

/* Books the extraction never logged, confirmed by hand. A reviewed term outranks every rule
   below it — the whole point of the review was that the rules could not see these. */
const REVIEWED_COMICS = lower(seeds.comics.terms);
const SHOW_SERIES = lower(seeds.showSeries.terms);
const SHOW_FORMAT = lower(seeds.showFormat.terms);

/* Which existing series does a term name? A reviewed comic is a topic-classified term, so by
   construction it is not itself a series key — it is the front of one or more comic strings. */
function seriesPrefixedBy(term) {
  const hits = new Set();
  for (const m of mentions) {
    if (series.clean(m.comic).toLowerCase().startsWith(term)) hits.add(m.series);
  }
  return [...hits].sort();
}

function classify(term) {
  const key = series.seriesKey(term, yearKeys);
  if (seriesKeys.has(key)) return ["series", seriesKeys.get(key)];
  if (SHOW_SERIES.has(term)) return ["showSeries", null];
  if (SHOW_FORMAT.has(term)) return ["showFormat", null];
  if (REVIEWED_COMICS.has(term)) {
    const hits = seriesPrefixedBy(term);
    /* One match merges into that page, which is the decision on record. Several means the
       tag names a franchise spanning separate pages — an episode tagged "godzilla" did not
       discuss all seven Godzilla series, so attaching it to each would claim seven books it
       never named. Those stay a browse axis of their own. */
    if (hits.length === 1) return ["series", hits[0]];
    if (hits.length > 1) return ["franchise", null, hits];
    return ["series", null];
  }
  if (SEGMENTS.has(term)) return ["topic", null];
  if (PUBLISHERS.has(term)) return ["publisher", null];
  if (CREATORS.has(term)) return ["creator", null];
  return ["topic", null];
}

/* A hint, deliberately not a rule. 213 topic terms appear somewhere inside a comic string,
   but a substring match also catches "annual", "anthology" and "black and white" — format
   words that happen to sit inside a title. Requiring the comic to *start* with the term is
   how a series name actually behaves, and the rest is left for a person to read. Promoting
   these automatically would invent series pages, which is the failure mode this project
   already knows: a wrong entry is worse than a missing one. */
const FORMAT_WORDS = new Set([
  "annual", "anthology", "anniversary", "biography", "best of", "one shot", "one-shot",
  "black and white", "autumn", "spring", "summer", "winter", "omnibus", "hardcover",
]);
const comicStarts = new Set();
for (const m of mentions) comicStarts.add(series.clean(m.comic).toLowerCase());

function looksLikeSeries(term) {
  if (term.length < 8 || FORMAT_WORDS.has(term) || SEGMENTS.has(term)) return false;
  for (const c of comicStarts) if (c.startsWith(term)) return true;
  return false;
}

const taxonomy = {};
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

writeFileSync("data/tag-taxonomy.json", JSON.stringify(taxonomy, null, 1) + "\n");
await vite.close();

const byType = {}, browsable = {};
for (const [, v] of Object.entries(taxonomy)) {
  byType[v.type] = (byType[v.type] ?? 0) + 1;
  if (v.episodes >= 3) browsable[v.type] = (browsable[v.type] ?? 0) + 1;
}
console.log(`${Object.keys(taxonomy).length} terms classified (aliases folded, noise dropped)`);
for (const t of ["series", "franchise", "publisher", "creator", "showSeries", "showFormat", "topic"]) {
  console.log(`  ${t.padEnd(10)} ${String(byType[t] ?? 0).padStart(5)}   ` +
              `${String(browsable[t] ?? 0).padStart(4)} on 3+ episodes`);
}
const once = Object.values(taxonomy).filter(v => v.episodes === 1).length;
console.log(`  single-episode terms: ${once} — real coverage, but not browse axes`);
console.log("→ data/tag-taxonomy.json");
