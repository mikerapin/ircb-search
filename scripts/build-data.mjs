import { createServer } from "vite";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const vite = await createServer({ server: { middlewareMode: true } });
const shape = await vite.ssrLoadModule("/src/data/shape.ts");

const epsRaw = JSON.parse(readFileSync("data/episodes.json", "utf8"));
const eps = shape.shapeEpisodes(epsRaw);
const det = shape.shapeDetails(epsRaw);
const men = shape.shapeMentions(JSON.parse(readFileSync("data/comics.json", "utf8")), eps);
shape.attachMentionCounts(eps, men);

// Keys are route parameters. A collision would silently merge two episodes into one page.
const keys = new Set(eps.map(e => e.key));
if (keys.size !== eps.length) {
  const seen = new Set();
  const dupes = eps.map(e => e.key).filter(k => (seen.has(k) ? true : (seen.add(k), false)));
  throw new Error(`duplicate episode keys: ${[...new Set(dupes)].slice(0, 5).join(", ")}`);
}

const stats = shape.buildStats(eps, men);
mkdirSync("public/d", { recursive: true });
writeFileSync("public/d/core.json", JSON.stringify({ stats, episodes: eps }));
writeFileSync("public/d/detail.json", JSON.stringify(det));
writeFileSync("public/d/mentions.json", JSON.stringify(men));
await vite.close();
console.log(`core ${eps.length} eps · ${men.length} mentions · ${stats.series} series · ${stats.people} people`);
