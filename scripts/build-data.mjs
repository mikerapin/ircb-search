import { createServer } from "vite";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const vite = await createServer({ server: { middlewareMode: true } });
const shape = await vite.ssrLoadModule("/src/data/shape.ts");
const seriesIndex = await vite.ssrLoadModule("/src/data/series-index.ts");

const epsRaw = JSON.parse(readFileSync("data/episodes.json", "utf8"));
const det = shape.shapeDetails(epsRaw);

/* The upstream table's Patreon shelf is 146 hand-typed rows with no date, no link and no
   comics. data/patreon.json holds the same shelf read out of the Secret Feed — 300 episodes
   with real dates, artwork, public post URLs and, where anything states one, comics. Drop the
   shelf and use the feed. Everything else in the table is untouched. */
const published = shape.shapeEpisodes(epsRaw).filter(e => !shape.isPatreonShelfRow(e));
const patreonRaw = JSON.parse(readFileSync("data/patreon.json", "utf8")).episodes;
const patreonShaped = shape.shapePatreonEpisodes(patreonRaw, published);
const patreon = shape.dropUnreleased(patreonShaped);
/* Holding one is normal between the Patreon drop and Wednesday's release. Say so anyway: a
   held episode is an episode missing from the site, and the count creeping up would mean
   parents have stopped resolving rather than that the week is early. */
for (const e of patreonShaped) {
  if (!patreon.includes(e)) console.log(`  held until its episode is public: ${e.title}`);
}
const eps = [...published, ...patreon];

/* The show's own episode numbers, and the panels recovered for Patreon runs that credit
   nobody. Both are checked-in CSVs rather than logic here: each row was measured against a
   second source before it was written, and a wrong one is fixed by editing a line. */
attachFromCsv("data/episode-numbers.csv", eps, (ep, row) => { ep.ep = Number(row.ep); });
attachFromCsv("data/patreon-panel-proposed.csv", eps, (ep, row) => {
  /* Only two flags withhold a panel. `not-patreon-exclusive` means the episode is the public
     one under a different number, and `hold` is a proposal known to be wrong — "IRCB's Best
     of 2022" lists whose picks were discussed, not who recorded, so it names all ten
     regulars. Both keep no panel rather than a guessed one.
     `stand-in` and `caution` are notes for a reader, not doubts: `stand-in` is the rule
     working, catching Kara Szamborski covering for Brian Murray on Movie Club #6. */
  if (row.flag === "hold" || row.flag === "not-patreon-exclusive" || !row.proposed) return;
  ep.people = row.proposed.split(";").map(s => s.trim()).filter(Boolean);
});

function attachFromCsv(path, episodes, apply) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  const byKey = new Map(episodes.map(e => [e.key, e]));
  let hit = 0;
  for (const row of rows) {
    const ep = byKey.get(row.key);
    if (!ep) continue;
    apply(ep, row);
    hit++;
  }
  if (!hit) throw new Error(`${path} matched no episodes — the key column has drifted`);
  console.log(`  ${path}: ${hit}/${rows.length} rows attached`);
}

/* A real parser rather than split(","), because titles carry commas and quotes — "Comics, A
   Quarter-Mile At A Time" would otherwise shift every column after it. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length)
             .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const live = new Set(patreon.map(e => e.key));
const men = [
  ...shape.shapeMentions(JSON.parse(readFileSync("data/comics.json", "utf8")), eps),
  ...shape.shapePatreonMentions(patreonRaw).filter(m => live.has(m.epKey)),
];

/* The show's own RSS keywords, for books the comic rows missed. Only terms the taxonomy typed
   as a series, and only onto runs the list above already holds — a tag adds an episode to a
   page, it never opens one. Both the mentions and the chips on the episode page go through the
   same resolver, so a tag cannot link to one page and file itself under another. */
const resolveTag = shape.tagSeriesResolver(
  JSON.parse(readFileSync("data/tag-taxonomy.json", "utf8")),
  Object.fromEntries(Object.entries(
    JSON.parse(readFileSync("data/tag-seeds.json", "utf8")).aliases)
    .filter(([k]) => !k.startsWith("_"))),
  men);
const tagged = shape.shapeTaggedMentions(det, resolveTag, men);
men.push(...tagged);
shape.attachTagSeries(det, resolveTag);
console.log(`  tags: ${tagged.length} mentions added, ` +
            `${new Set(tagged.map(m => m.series)).size} series pages touched`);

shape.attachMentionCounts(eps, men);

// Keys are route parameters. A collision would silently merge two episodes into one page.
const keys = new Set(eps.map(e => e.key));
if (keys.size !== eps.length) {
  const seen = new Set();
  const dupes = eps.map(e => e.key).filter(k => (seen.has(k) ? true : (seen.add(k), false)));
  throw new Error(`duplicate episode keys: ${[...new Set(dupes)].slice(0, 5).join(", ")}`);
}

const patreonSeries = shape.buildPatreonSeries(
  patreonRaw, JSON.parse(readFileSync("data/patreon-series.json", "utf8")));
const stats = shape.buildStats(eps, men);
mkdirSync("public/d", { recursive: true });
writeFileSync("public/d/core.json", JSON.stringify({ stats, episodes: eps, patreonSeries }));
writeFileSync("public/d/detail.json", JSON.stringify(det));
writeFileSync("public/d/mentions.json", JSON.stringify(men));
/* The Index is nothing but this table, and deriving it in the browser meant waiting for the
   whole mention list to arrive first. Same function, run once here. */
const rows = seriesIndex.seriesRows(men);
writeFileSync("public/d/index.json", JSON.stringify(rows));
await vite.close();
console.log(`core ${eps.length} eps · ${men.length} mentions · ${stats.series} series · ${stats.people} people`);
