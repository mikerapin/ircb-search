import { normalizeSeries } from "../data/series";
import { esc } from "../lib/html";

/* The generated trade-dress cover: a plate that needs no artwork. Real cover images are
   post-launch, so every comic mention prints its own. Ported from the prototype. */

const FIELDS: Array<[field: string, text: string]> = [
  ["var(--red)", "#14120F"], ["var(--blue)", "var(--paper)"],
  ["var(--yellow)", "#14120F"], ["var(--ink)", "var(--yellow)"],
  ["var(--tint)", "#14120F"], ["var(--paper-2)", "var(--ink)"],
  ["var(--ink)", "var(--red)"], ["var(--blue)", "var(--yellow)"],
];
const PUBS = ["IRCB Archive", "On air", "Indexed", "The pile"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/** The No. box is identity only: the string's own issue/volume number, else a year. */
export function num(str: string, fallbackDate: string | null): string {
  let m = /#\s*([0-9]+)/.exec(str); if (m) return "#" + m[1];
  m = /\b(?:vol\.?|volume|book)\s*([0-9]+)/i.exec(str); if (m) return "V" + m[1];
  m = /\b(19|20)[0-9]{2}\b/.exec(str); if (m) return m[0];
  return fallbackDate ? fallbackDate.slice(0, 4) : "—";
}

function plateFor(seed: string): [string, string] {
  const y = /^(20[0-9]{2})$/.test(seed) ? Number(seed) - 2016 : hash(seed);
  return FIELDS[((y % FIELDS.length) + FIELDS.length) % FIELDS.length]!;
}

export function cover(title: string, extraClass: string, seed: string | null, noLabel: string | null): string {
  const s = normalizeSeries(title);
  const h = hash(s);
  const f = plateFor(seed == null ? s : seed);
  const words = s.split(/\s+/).filter(Boolean);
  let longest = 1;
  for (const w of words) for (const p of w.split("/")) longest = Math.max(longest, p.length);
  let size = Math.max(7, Math.min(20, 92 / Math.max(longest, 3)));
  if (words.length >= 5) size = Math.min(size, 10);
  else if (words.length === 4) size = Math.min(size, 12);
  else if (words.length === 3) size = Math.min(size, 15);
  const marked = esc(s).replace(/(\/)/g, "$1<wbr>");
  return `<span class="gc ${extraClass}" style="--gc-f:${f[0]};--gc-t:${f[1]}" aria-hidden="true">` +
    `<span class="gc-bar"></span><span class="gc-screen"></span>` +
    `<span class="gc-t" style="font-size:${size.toFixed(1)}cqw">${marked}</span>` +
    `<span class="gc-rule"></span>` +
    `<span class="gc-pub">${PUBS[h % PUBS.length]}</span>` +
    `<span class="gc-no">${esc(noLabel ?? num(title, /^\d{4}$/.test(String(seed)) ? String(seed) : null))}</span>` +
  `</span>`;
}

/** Shrink plate titles until the longest word fits the plate. */
export function fitPlates(root: ParentNode): void {
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;left:-9999px;top:0;white-space:nowrap;visibility:hidden";
  document.body.appendChild(probe);
  for (const el of root.querySelectorAll<HTMLElement>(".gc-t")) {
    const avail = el.clientWidth, plate = el.parentElement;
    if (!avail || !plate) continue;
    if (!el.dataset["base"]) el.dataset["base"] = el.style.fontSize;
    else el.style.fontSize = el.dataset["base"];
    const cs = getComputedStyle(el);
    let size = parseFloat(cs.fontSize);
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontWeight = cs.fontWeight;
    probe.style.fontSize = cs.fontSize;
    probe.style.fontVariationSettings = cs.fontVariationSettings;
    probe.style.letterSpacing = cs.letterSpacing;
    probe.style.textTransform = cs.textTransform;
    let widest = 0;
    for (const t of (el.textContent ?? "").split(/[\s/]+/)) {
      if (!t) continue;
      probe.textContent = t;
      // Fractional width: offsetWidth rounds to an integer, so a word that is really
      // 106.4px wide in a 106px box measures as exactly fitting and then wraps mid-word.
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    const room = avail - 1;                       // leave a pixel rather than land on the boundary
    if (widest > room) { size = Math.max(7, size * (room / widest)); el.style.fontSize = size + "px"; }
    const maxH = plate.clientHeight * 0.78 - el.offsetTop;
    for (let i = 0; i < 8 && el.scrollHeight > maxH && size > 7; i++) { size *= 0.9; el.style.fontSize = size + "px"; }
  }
  probe.remove();
}
