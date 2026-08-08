import { createServer } from "vite";
import { readFileSync, writeFileSync } from "node:fs";

/* What the normalizer actually does to the real heading set. Run before and after any
   change to src/data/series.ts — a big swing in group count means something folded that
   shouldn't have. Output feeds the About page's published rules. */

const vite = await createServer({ server: { middlewareMode: true } });
const shape = await vite.ssrLoadModule("/src/data/shape.ts");
const series = await vite.ssrLoadModule("/src/data/series.ts");

const epsRaw = JSON.parse(readFileSync("data/episodes.json", "utf8"));
const eps = shape.shapeEpisodes(epsRaw);
const men = shape.shapeMentions(JSON.parse(readFileSync("data/comics.json", "utf8")), eps);

const raw = new Set(men.map(m => series.clean(m.comic)).filter(Boolean));

// normalized name -> { mentions, episodes, variants }
const groups = new Map();
for (const m of men) {
  let g = groups.get(m.series);
  if (!g) groups.set(m.series, (g = { mentions: 0, eps: new Set(), variants: new Set() }));
  g.mentions++;
  g.eps.add(m.epKey);
  g.variants.add(series.clean(m.comic));
}

const rows = [...groups].map(([name, g]) => ({
  name, mentions: g.mentions, episodes: g.eps.size, variants: [...g.variants].sort(),
})).sort((a, b) => b.mentions - a.mentions);

// Cheap bounded edit distance — we only care about <= 2.
function within2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  let i = 0, j = a.length - 1, k = b.length - 1;
  while (i <= j && i <= k && a[i] === b[i]) i++;
  while (j >= i && k >= i && a[j] === b[k]) { j--; k--; }
  return (j - i + 1) <= 2 && (k - i + 1) <= 2;
}

const names = rows.map(r => r.name);
const byKey = new Map();
for (const n of names) {
  const k = n.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  (byKey.get(k) ?? byKey.set(k, []).get(k)).push(n);
}
const near = [];
for (const bucket of byKey.values()) {
  for (let a = 0; a < bucket.length; a++)
    for (let b = a + 1; b < bucket.length; b++) {
      const x = bucket[a].toLowerCase(), y = bucket[b].toLowerCase();
      if (x !== y && within2(x, y)) near.push([bucket[a], bucket[b]]);
    }
}

const out = [];
out.push("# Series normalization — measured report");
out.push("");
out.push(`Generated from the live data by \`scripts/series-report.mjs\`. Do not hand-edit.`);
out.push("");
out.push("| Measure | Value |");
out.push("|---|---|");
out.push(`| Raw distinct headings (after \`clean()\`) | ${raw.size} |`);
out.push(`| Distinct series after \`normalizeSeries()\` | ${rows.length} |`);
out.push(`| Headings folded away | ${raw.size - rows.length} |`);
out.push(`| Groups that fold 2+ variants | ${rows.filter(r => r.variants.length > 1).length} |`);
out.push(`| Series mentioned once | ${rows.filter(r => r.mentions === 1).length} |`);
out.push(`| Total mentions | ${men.length} |`);
out.push("");
out.push("## Rules applied");
out.push("");
out.push("Display name (`normalizeSeries`) strips: issue numbers (`#50`, `#1-6`), volume and book");
out.push("markers (`Vol. 2`, `Volume 6-7`, `Book 3`), manga chapter numbers (`Chapter 381`, `Ch. 1044`),");
out.push("a trailing year (`(1991)`), `ft.` credits, scraped HTML fragments, and trailing punctuation.");
out.push("");
out.push("Grouping key (`seriesKey`) additionally ignores case, quote style and every separator, so");
out.push("`Star Wars: Visions` and `Star Wars Visions` are one run. Apostrophes are removed rather than");
out.push("treated as a word break, so `Dead Dog's Bite` and `Dead Dogs Bite` group together. Each group");
out.push("displays whichever spelling was written most often.");
out.push("");
out.push("## Rules deliberately NOT applied");
out.push("");
out.push("These would each merge headings a human can tell apart, so they are left split and listed here");
out.push("instead. A wrong merge silently misstates which episodes discussed which book.");
out.push("");
out.push("- **Letter-level similarity.** `Monster`/`Monsters`, `Black Magick`/`Black Magic`, `The Forged`/`The Forge`, `Blue Book`/`Blue Box`, `Immortal Iron Fist`/`Immortal Iron Fists` are different books.");
out.push("- **Word-boundary differences.** `Dragonball Z`/`Dragon Ball Z`, `Oldboy`/`Old Boy`, `Head Lopper`/`Headlopper`, `Home Sick Pilots`/`Homesick Pilots` are the same book written two ways, but a space-insensitive key risks merging genuinely distinct titles, so they stay split.");
out.push("- **Sequel and volume markers in the name.** `Archie vs Predator`/`Archie vs Predator 2`, `Predator Hunters II`/`III`, `Harbinger Wars II`/`Harbinger Wars 2` — sometimes one run, sometimes separate miniseries. No rule gets this right without a human.");
out.push("- **Romanisation and typos.** `Haikyu!!`/`Haikyuu!!`, `Millenium`/`Millennium`.");
out.push("");
out.push("## 40 largest collapse groups (normalized name ← variants folded in)");
out.push("");
const collapsed = rows.filter(r => r.variants.length > 1)
  .sort((a, b) => b.variants.length - a.variants.length).slice(0, 40);
for (const r of collapsed) {
  out.push(`- **${r.name}** — ${r.mentions} mention(s), ${r.episodes} ep(s), ${r.variants.length} variants`);
  out.push(`  - ${r.variants.slice(0, 12).map(v => "`" + v + "`").join(" · ")}${r.variants.length > 12 ? ` … +${r.variants.length - 12}` : ""}`);
}
out.push("");
out.push(`## Near-miss pairs (edit distance ≤ 2, still separate) — ${near.length} found, showing 40`);
out.push("");
out.push("Each pair is either a normalization gap or two genuinely different series. Judgement required — folding a real pair is worse than leaving a duplicate.");
out.push("");
for (const [a, b] of near.slice(0, 40)) out.push(`- \`${a}\`  ↔  \`${b}\``);
out.push("");

const REPORT = "/Users/mike/Library/CloudStorage/Dropbox/Keep/claudeOS/ircb/specs/search-redesign/series-normalization-report.md";
writeFileSync(REPORT, out.join("\n"));
console.log(`raw ${raw.size} → normalized ${rows.length} (folded ${raw.size - rows.length}); near-miss pairs ${near.length}`);
await vite.close();
