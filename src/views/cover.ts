import { normalizeSeries } from "../data/series";
import { esc, fmtDate, fmtRuntime } from "../lib/html";

/* The generated trade-dress cover: a plate that needs no artwork. Real cover images are
   post-launch, so every comic mention prints its own. Ported from the prototype. */

const FIELDS: Array<[field: string, text: string]> = [
  /* --red-deep, not --red: dark ink on the bright red measured 4.29:1, and a plate title
     is not always large text — fitPlates sizes it in cqw, so a rack slot renders it at
     ~13px. House rule 2, applied to the plate palette. */
  /* The three pairs that letter in --gc-yellow / --gc-red are the ones whose field also
     goes bright on the negative plate. Those tokens carry the accent on paper and dark ink
     in the negative; using --yellow and --red directly measured 1.41, 2.19 and 1.12 there,
     and a deliberate test.fail() on the light plate's 4.29 was masking all three. */
  ["var(--red-deep)", "var(--paper)"], ["var(--blue)", "var(--paper)"],
  ["var(--yellow)", "#14120F"], ["var(--ink)", "var(--gc-yellow)"],
  ["var(--tint)", "#14120F"], ["var(--paper-2)", "var(--ink)"],
  ["var(--ink)", "var(--gc-red)"], ["var(--blue)", "var(--gc-yellow)"],
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
  // "volumes" too, so this agrees with normalizeSeries. Headings do say "Volumes 1 and 2".
  m = /\b(?:vol\.?|volume|volumes|book)\s*([0-9]+)/i.exec(str); if (m) return "V" + m[1];
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
  /* Split *after* the slash so it stays on the segment it will actually render with: the
     <wbr> below goes after the "/", so "Superman/Batman" wraps as "Superman/" + "Batman"
     and the widest line is 9 characters, not the 8 that splitting on "/" reported. One
     character of under-measurement was enough for `overflow-wrap:break-word` to break the
     word mid-letter on the plates that have a slash. */
  for (const w of words) for (const p of w.split(/(?<=\/)/)) longest = Math.max(longest, p.length);
  let size = Math.max(7, Math.min(20, 92 / Math.max(longest, 3)));
  if (words.length >= 5) size = Math.min(size, 10);
  else if (words.length === 4) size = Math.min(size, 12);
  else if (words.length === 3) size = Math.min(size, 15);
  /* Each break-segment is wrapped so the browser cannot split it at an internal hyphen.
     `hyphens:none` only disables automatic hyphenation — a hyphen already in the text stays a
     break opportunity, and the greedy line-filler takes it whenever it packs the line better,
     which set "Age of X-Man: Prisoner X" as "AGE OF X-" / "MAN:". A segment is exactly the
     unit fitPlates sizes to fit, so what is measured is now what cannot be broken, and the
     <wbr> after a slash is still the one place a long title may wrap inside a word. */
  const marked = s.split(/(\s+)/).map(part =>
    /^\s*$/.test(part) ? esc(part)
      : part.split(/(?<=\/)/).map(seg => `<span class="nb">${esc(seg)}</span>`).join("<wbr>")
  ).join("");
  return `<span class="gc ${extraClass}" style="--gc-f:${f[0]};--gc-t:${f[1]}" aria-hidden="true">` +
    `<span class="gc-bar"></span><span class="gc-screen"></span>` +
    `<span class="gc-t" style="font-size:${size.toFixed(1)}cqw">${marked}</span>` +
    `<span class="gc-rule"></span>` +
    `<span class="gc-pub">${PUBS[h % PUBS.length]}</span>` +
    `<span class="gc-no">${esc(noLabel ?? num(title, /^\d{4}$/.test(String(seed)) ? String(seed) : null))}</span>` +
  `</span>`;
}

/* Publishers have a name for a cover with no art on it: the blank variant. */
export function blankVariant(e: { date: string | null; key: string; runtimeSecs: number | null }): string {
  const yr = (e.date ?? "").slice(0, 4);
  const f = plateFor(yr || e.key || "x");
  const d = e.date ? fmtDate(e.date).replace(",", "") : "Date unknown";
  return `<span class="gc blank" style="--gc-f:${f[0]};--gc-t:${f[1]}" aria-hidden="true">` +
    `<span class="gc-screen"></span>` +
    `<span class="bv-wm">I Read Comic Books</span>` +
    `<span class="bv-d">${esc(d)}</span>` +
    `<span class="gc-rule"></span>` +
    `<span class="gc-pub">No artwork on file</span>` +
    `<span class="gc-no">${esc(fmtRuntime(e.runtimeSecs) || "Blank")}</span>` +
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
    /* Split *after* the slash, matching the segments cover() marks nowrap — measuring
       "Superman" where the page renders an unbreakable "Superman/" leaves the plate a slash
       narrower than the text it has to hold. */
    for (const t of (el.textContent ?? "").split(/\s+/).flatMap(w => w.split(/(?<=\/)/))) {
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
