import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

/** The show's first year, the same one the indicia and the coupon print. */
const SHOW_START = 2015;

/**
 * How many years the archive covers, filled into index.html at build time.
 *
 * index.html is static, so a number typed into it is a number nobody recomputes — which is
 * how the meta description came to advertise "11 years" from whenever someone last touched
 * it. It was the only hardcoded count in any user-facing string on the site; everything else
 * is counted from the data at render.
 *
 * The span ends at the newest episode we actually hold, not at today's date. A clock would
 * keep incrementing this if the feed stalled, advertising a year of episodes that don't
 * exist — the same class of fault as the health line that counted a field Simplecast had
 * broken. Ending it on the data means the claim can only grow when the archive does.
 *
 * `npm run build` writes public/d/core.json before vite runs, and CI builds before it tests,
 * so the file is there whenever the number is going to be seen. A bare `vite dev` on a fresh
 * clone has no data at all and every route paints the offline message, so the clock is a
 * good enough stand-in for one string in the <head>.
 */
function archiveYears(): number {
  let end = new Date().getFullYear();
  try {
    /* Relative to cwd. Every documented entry point runs vite from the project root; if one
       doesn't, this throws and we fall back rather than emitting a wrong number. */
    const core = JSON.parse(readFileSync("public/d/core.json", "utf8")) as {
      episodes: Array<{ date: string | null }>;
    };
    const newest = core.episodes.reduce<string | null>(
      (d, e) => (e.date && (!d || e.date > d) ? e.date : d), null);
    if (newest) end = Number(newest.slice(0, 4));
  } catch { /* no data built yet — dev only, see above */ }
  return end - SHOW_START;
}

export default defineConfig({
  build: { target: "es2022" },
  plugins: [{
    name: "ircb-archive-years",
    /* `pre`, so the placeholder is resolved before Vite's own %VITE_*% pass reads the file. */
    transformIndexHtml: {
      order: "pre",
      handler: (html: string) => html.replaceAll("%YEARS%", String(archiveYears())),
    },
  }],
});
