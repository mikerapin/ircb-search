import { createHash } from "node:crypto";
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

/**
 * The Content-Security-Policy, assembled from the page it is about to protect.
 *
 * The old site carried one. The redesign rewrote index.html and the policy did not come
 * with it, so search.ircbpodcast.com has been shipping with no CSP at all — the backlog
 * still describes the job as "drop 'unsafe-inline' from script-src", which stopped being
 * true the moment the file was replaced.
 *
 * The hash is computed here rather than typed in because a hand-copied hash is a derived
 * value stored as source: edit the inline script, forget the hash, and the browser silently
 * refuses to run the thing that stops the page flashing white. That is the same failure as
 * the tag taxonomy checked in beside the data it was derived from, and the same defence —
 * it cannot be older than its input.
 *
 * Two directives are deliberately loose, and both are load-bearing rather than lazy:
 *
 *   style-src 'unsafe-inline' — twelve view modules set style="" attributes (container
 *   queries on cover plates, grid spans on the wall). Attribute styles cannot be hashed;
 *   'unsafe-hashes' is the mechanism and its support is not broad enough to bet the site
 *   on. An injected style attribute cannot execute, so this is the cheap half of the win.
 *
 *   media-src https: — the enclosure is media.blubrry.com, which redirects to
 *   dts.podtrac.com and onward, and CSP checks the URLs a redirect chain lands on. Pinning
 *   the hosts means knowing the whole chain, and finding it out means fetching a real
 *   enclosure — the exact thing tests/fake-audio.ts exists to prevent, because a request
 *   that delivers audio is a counted IAB download and would inflate the show's own numbers.
 *   Breaking playback on a live podcast to tighten a directive that cannot execute code is
 *   the wrong trade. Narrow it when someone can confirm the chain from Simplecast's side.
 *
 * frame-ancestors is absent on purpose: a <meta> policy cannot carry it, and GitHub Pages
 * serves no custom headers. Clickjacking cover would need a host that does.
 */
function csp(html: string, dev: boolean): string {
  /* Every <script> without a src, which is our pre-paint plate restore and nothing else.
     Vite's own dev client and the built bundle are external, so they answer to 'self'. */
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => `'sha256-${createHash("sha256").update(m[1] ?? "", "utf8").digest("base64")}'`);
  if (!hashes.length) throw new Error("csp: no inline script found — the hash pass is silently doing nothing");
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://image.simplecastcdn.com https://c10.patreonusercontent.com",
    "media-src https:",
    "font-src 'self'",
    /* ws: is the one dev/production difference, for Vite's HMR socket. The suite runs
       against `npm run dev`, so every other directive here is the one under test. */
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "form-action 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

export default defineConfig({
  build: { target: "es2022" },
  plugins: [{
    name: "ircb-index-html",
    /* `pre`, so the placeholder is resolved before Vite's own %VITE_*% pass reads the file. */
    transformIndexHtml: {
      order: "pre",
      handler: (html: string, ctx) => html
        .replaceAll("%YEARS%", String(archiveYears()))
        .replaceAll("%CSP%", csp(html, !!ctx.server)),
    },
  }],
});
