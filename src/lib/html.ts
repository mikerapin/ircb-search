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

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-05" → "Aug 5, 2026". Dates are already normalized, so no Date parsing here. */
export function fmtDate(d: string | null): string {
  if (!d) return "";
  const p = d.split("-");
  const mon = MON[Number(p[1]) - 1];
  return mon ? `${mon} ${Number(p[2])}, ${p[0]}` : "";
}
