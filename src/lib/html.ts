export function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Plural suffix: "" for one, "s" for anything else. */
export function pl(n: number): string {
  return n === 1 ? "" : "s";
}

export function nf(n: number): string {
  return Number(n).toLocaleString("en-US");
}

/** 3753 → "1:02:33", 1980 → "33:00". A runtime, not a field width. */
export function fmtRuntime(secs: number | null): string {
  if (secs == null || !(secs > 0)) return "";
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0");
}

/** 3753 → "01h02m33s" — the time anchor Simplecast's player reads off the URL. */
export function secsToSimplecastT(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}m${String(x).padStart(2, "0")}s`;
}

const SAFE_HOSTS = new Set(["simplecast.com", "ircbpodcast.simplecast.com", "player.simplecast.com"]);

/** An outbound player link, or null when the URL is not one we trust. */
export function simplecastAt(url: string | null, secs: number | null): string | null {
  if (!url || secs == null || !(secs > 0)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !SAFE_HOSTS.has(u.hostname.toLowerCase())) return null;
    u.searchParams.set("t", secsToSimplecastT(secs));
    return u.toString();
  } catch { return null; }
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-05" → "Aug 5, 2026". Dates are already normalized, so no Date parsing here. */
export function fmtDate(d: string | null): string {
  if (!d) return "";
  const p = d.split("-");
  const mon = MON[Number(p[1]) - 1];
  return mon ? `${mon} ${Number(p[2])}, ${p[0]}` : "";
}
