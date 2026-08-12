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
 * Four rules, in order. Anything unmatched becomes `topic`, which is the bucket to review:
 *   series    — the term resolves to a key already in the series index, via the app's own
 *               seriesKey() rather than a re-implementation, so the two cannot disagree
 *   publisher — listed in data/tag-seeds.json
 *   creator   — listed in data/tag-seeds.json, or a known guest from the episode roster
 *   topic     — everything else
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
const shape = await vite.ssrLoadModule("/src/data/shape.ts");

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

function classify(term) {
  const key = series.seriesKey(term, yearKeys);
  if (seriesKeys.has(key)) return ["series", seriesKeys.get(key)];
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
  const [type, seriesName] = classify(term);
  const hint = type === "topic" && looksLikeSeries(term);
  taxonomy[term] = {
    type,
    episodes: keys.size,
    ...(seriesName ? { series: seriesName } : {}),
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
for (const t of ["series", "publisher", "creator", "topic"]) {
  console.log(`  ${t.padEnd(10)} ${String(byType[t] ?? 0).padStart(5)}   ` +
              `${String(browsable[t] ?? 0).padStart(4)} on 3+ episodes`);
}
const once = Object.values(taxonomy).filter(v => v.episodes === 1).length;
console.log(`  single-episode terms: ${once} — real coverage, but not browse axes`);
console.log("→ data/tag-taxonomy.json");
