// @ts-check
// Pure formatting, escaping, and parsing helpers — no app state, no DOM.

/** @typedef {import("./types").Episode} Episode */

/**
 * Convert a "HH:MM:SS" or "MM:SS" timestamp to total seconds.
 * @param {string|undefined|null} ts
 * @returns {number}
 */
export function tsToSeconds(ts) {
    if (!ts) return 0;
    const parts = String(ts).split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    if (parts.length === 2) return parts[0]*60 + parts[1];
    return 0;
}

/**
 * Format seconds as Simplecast's "00h01m31s" time anchor.
 * @param {number} secs
 * @returns {string}
 */
export function secsToSimplecastT(secs) {
    if (!secs) return "";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2,"0")}h${String(m).padStart(2,"0")}m${String(s).padStart(2,"0")}s`;
}

/**
 * Format a raw date string as "Jun 17, 2026". Returns "" on bad input.
 * @param {string|undefined|null} raw
 * @returns {string}
 */
export function fmtDate(raw) {
    if (!raw) return "";
    try {
        const d = new Date(raw);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch { return ""; }
}

/**
 * Normalize a mention timestamp for display, or null if it's empty/zero.
 * @param {string|undefined|null} ts
 * @returns {string|null}
 */
export function fmtTs(ts) {
    if (!ts || /^0*:?00:00$/.test(String(ts).trim())) return null;
    return String(ts).replace(/^00:/, ""); // trim leading hours if zero
}

const SAFE_HOSTS = new Set([
    "simplecast.com", "ircbpodcast.simplecast.com", "player.simplecast.com",
    "patreon.com", "github.com"
]);

/**
 * Return url only if it's https and on an allowlisted host, else "#".
 * @param {unknown} url
 * @returns {string}
 */
export function safeUrl(url) {
    if (typeof url !== "string" || !url) return "#";
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return "#";
        if (SAFE_HOSTS.has(u.hostname.toLowerCase())) return url;
    } catch { /* invalid URL */ }
    return "#";
}

/**
 * HTML-escape a value for safe interpolation into markup.
 * @param {unknown} s
 * @returns {string}
 */
export function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/**
 * Strip issue numbers, trailing years, and ft. credits to group a series.
 * @param {string} name
 * @returns {string}
 */
export function normalizeSeries(name) {
    if (!name) return name;
    return String(name)
        .replace(/\s*#[\d][\d\-–,]*.*$/, '')  // strip #1, #1-6, #20–24, etc.
        .replace(/\s*\(\d{4}\)\s*$/, '')        // strip trailing year (1997)
        .replace(/\s+ft\..+$/i, '')             // strip ft. credits
        .trim() || name;
}

/** Keywords too generic to count as a meaningful "related episode" signal. */
export const KEYWORD_NOISE = new Set([
    "comic books", "comics", "ircb", "i read comic books",
    "goodreads", "interview", "kickstarter"
]);

/**
 * Split a comma-separated people string into trimmed names.
 * @param {string|undefined|null} str
 * @returns {string[]}
 */
export function parsePeople(str) {
    if (!str) return [];
    return str.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * True when an episode title marks it as a guest ("(ft.") episode.
 * @param {Pick<Episode, "title">} ep
 * @returns {boolean}
 */
export function isGuestEp(ep) {
    return (ep.title || "").includes("(ft.");
}
