/**
 * QA screenshot set for the exit-check eyeball pass.
 *
 * Shoots the built bundle through `vite preview`, not the dev server, so the set is of the
 * thing that actually deploys — and so running it doubles as the second half of Plan 2's
 * exit check 8 ("`npm run build` succeeds and `npm run preview` serves every route").
 *
 *   node scripts/shots.mjs <baseUrl> <outDir> [scale]
 *
 * `scale` is deviceScaleFactor and defaults to 1, matching the earlier sets. A 30-shot set
 * is ~30 MB at 1x and ~100 MB at 2x — larger than this repo's entire history — so retina is
 * opt-in, for when the thing under review is 7.5px type or a hairline rule.
 *
 * Route keys are resolved from live core.json rather than pinned, so the set never shoots a
 * 404 after the Thursday data refresh.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire("/Users/mike/sites/ircb-search/");
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:5190";
const OUT = process.argv[3] ?? "/Users/mike/Library/CloudStorage/Dropbox/Keep/claudeOS/ircb/specs/search-redesign/qa/shots";
const SCALE = Number(process.argv[4] ?? 1);
mkdirSync(OUT, { recursive: true });

const core = await fetch(`${BASE}/d/core.json`).then(r => r.json());
const men = await fetch(`${BASE}/d/mentions.json`).then(r => r.json());

/* An episode that exercises the most surface: artwork, audio and several logged minutes. */
const byEp = new Map();
for (const m of men) byEp.set(m.epKey, (byEp.get(m.epKey) ?? 0) + 1);
const ep = core.episodes
  .filter(e => e.artwork && e.enclosure && e.date && (byEp.get(e.key) ?? 0) >= 5)
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];

const topSeries = [...men.reduce((m, x) => m.set(x.series, (m.get(x.series) ?? 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1])[0][0];

const PLAN = [
  ["home", "#/"],
  ["search", `#/search?q=batman`],
  ["episode", `#/ep/${encodeURIComponent(ep.key)}`],
  ["series", `#/series/${encodeURIComponent(topSeries)}`],
  ["who", "#/who/Mike%20Rapin"],
  ["panel", "#/panel"],
  ["index", "#/index"],
  ["about", "#/about"],
  ["subscribe", "#/subscribe"],
  ["wall", "#/wall"],
];

// [suffix, width, height, negative plate?]
const VIEWPORTS = [["390", 390, 844, false], ["1440", 1440, 900, false], ["neg-1440", 1440, 900, true]];

const browser = await chromium.launch();
const problems = [];
const shot = [];

for (const [suffix, width, height, neg] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: SCALE });
  if (neg) await ctx.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  for (const [name, hash] of PLAN) {
    const before = errs.length;
    await page.goto(`${BASE}/${hash}`, { waitUntil: "load" });
    /* The same readiness the route sweep uses: body[data-ready] is stamped before core() is
       even called, so it proves nothing about #view. Wait for paint. */
    await page.waitForFunction(
      () => (document.getElementById("view")?.innerText ?? "").trim().length > 0,
      null, { timeout: 20000 },
    ).catch(() => problems.push(`${name}-${suffix}: #view never painted`));
    await page.evaluate(() => document.fonts.ready);
    // Home hydrates the Rack and Shuffle in a second pass; scroll so lazy work finishes.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y); await new Promise(r => setTimeout(r, 50));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);

    const file = `${OUT}/${name}-${suffix}.png`;
    await page.screenshot({ path: file, fullPage: true });
    shot.push(`${name}-${suffix}.png`);
    if (errs.length > before) problems.push(`${name}-${suffix}: ${errs.slice(before).join(" | ")}`);
    process.stdout.write(`  ${name}-${suffix}\n`);
  }
  await ctx.close();
}

await browser.close();

const summary = [
  `# QA shot set`,
  ``,
  `Base: ${BASE} (built bundle via \`vite preview\`)`,
  `Episode: ${ep.title} — ${ep.key} (${byEp.get(ep.key)} mentions)`,
  `Series: ${topSeries}`,
  `Routes: ${PLAN.length} × ${VIEWPORTS.length} viewports = ${shot.length} shots at ${SCALE}x`,
  `Regenerate: \`node scripts/shots.mjs <preview-url> <dir> [scale]\` — pass 2 for retina.`,
  ``,
  problems.length ? `## Problems (${problems.length})\n\n` + problems.map(p => `- ${p}`).join("\n")
    : `## Problems\n\nNone — every route painted and no console errors on any viewport.`,
  ``,
].join("\n");
writeFileSync(`${OUT}/README.md`, summary);
console.log(`\n${shot.length} shots → ${OUT}`);
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "no console errors, every route painted");
process.exit(problems.length ? 1 : 0);
