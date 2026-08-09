import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, pl } from "../lib/html";
import { jumpable } from "../search/engine";
import { blankVariant, cover, num } from "./cover";
import { href } from "../router";

/** A comic cover carries a price; an episode carries a runtime. */
export function priceBox(e: EpisodeCore): string {
  const r = fmtRuntime(e.runtimeSecs);
  return r ? `<span class="pricebox">${esc(r)}<small>Runtime</small></span>` : "";
}

export function epHref(e: EpisodeCore): string {
  return href("/ep/" + encodeURIComponent(e.key));
}

/* 252 episodes carry no artwork. They used to get an empty <a>, which collapsed to the
   2px border — the "reserved slot" the stylesheet promised was never reserved, because
   the aspect-ratio sat on the img rather than on the anchor. They now get the same
   generated plate the episode hero has always used for this case. */
function art(e: EpisodeCore): string {
  const link = epHref(e);
  if (!e.artwork) {
    return `<a class="epw-art gen" href="${link}" style="container-type:inline-size" ` +
      `aria-hidden="true" tabindex="-1">${blankVariant(e)}</a>`;
  }
  return `<a class="epw-art" href="${link}" tabindex="-1" aria-hidden="true">` +
    `<img src="${esc(e.artwork)}" alt="" loading="lazy">${priceBox(e)}</a>`;
}

export function episodePanel(e: EpisodeCore): string {
  const n = e.mentionCount;
  return `<article class="panel" data-ep="${esc(e.key)}"><div class="epw">` +
    art(e) +
    `<div class="pbody">` +
      `<div class="micro" style="opacity:.7">${esc(fmtDate(e.date) || "Date unknown")} · ${n} comic${pl(n)}</div>` +
      `<h3 class="disp" style="font-size:17px;margin:0;line-height:1.05">` +
        `<a href="${epHref(e)}" style="color:inherit">${esc(e.title || "Untitled episode")}</a></h3>` +
      `<div class="credits">${esc(e.people.join(", ") || "Panel unknown")}</div>` +
      `<div class="spacer"></div>` +
      `<a class="ts dark" href="${epHref(e)}"><span class="tri">▤</span>Open the episode` +
        `<span class="lab">${n} moment${pl(n)}</span></a>` +
    `</div>` +
  `</div></article>`;
}

/* Inline rather than an icon font: a whole font for one glyph, loaded at runtime from
   somewhere, against a spec that forbids third-party requests. currentColor means it
   inherits on both plates. */
const PATREON_MARK =
  `<svg class="pmark" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" focusable="false">` +
    `<circle cx="15.2" cy="9.4" r="6.6" fill="currentColor"/>` +
    `<rect x="2" y="2.8" width="3.6" height="18.4" fill="currentColor"/>` +
  `</svg>`;

/**
 * What to call an episode. Feed episodes carry their broadcast number; the Patreon shelf
 * wears the Patreon mark; a bonus record gets a B. Anything else — the pre-feed back
 * catalogue — goes unlabelled rather than borrowing a number it never had.
 */
export function episodeBadge(e: EpisodeCore, feedNo: number | undefined): string {
  if (feedNo) return `EP. ${feedNo}`;
  if (e.patreonUrl) return `${PATREON_MARK}<span class="pl">Patreon</span>`;
  if (/\bbonus\b/i.test(e.title)) return `<span class="bbadge" title="Bonus episode">B</span>`;
  return "";
}

export function sfx(text: string): string {
  return `<div class="sfx">${esc(text)}</div>`;
}

/** Newest first; episodes with no air date sort last. */
export function byDateDesc(a: EpisodeCore, b: EpisodeCore): number {
  if (a.date === b.date) return 0;
  if (a.date === null) return 1;
  if (b.date === null) return -1;
  return a.date < b.date ? 1 : -1;
}

/** First names only — the panel line under a mention plate has no room for more. */
export function firstNames(people: string[]): string {
  return people.map(p => p.split(" ")[0]).join(" · ");
}

/** Shared by search results and the episode read-along. */
export function mentionPanel(m: Mention, ep: EpisodeCore | undefined, opts?: { until?: number | null }): string {
  const yr = ep?.date ? ep.date.slice(0, 4) : null;
  const noLab = num(m.comic, null) === "—" && yr ? yr : null;
  const seriesLink = href("/series/" + encodeURIComponent(m.series));
  const epLink = href("/ep/" + encodeURIComponent(m.epKey));
  const until = opts?.until;
  return `<article class="panel" data-ep="${esc(m.epKey)}" data-secs="${m.secs ?? ""}" data-comic="${esc(m.comic)}"${until != null ? ` data-until="${until}"` : ""}>` +
    `<a class="gcwrap" href="${seriesLink}" style="container-type:inline-size;display:block" aria-label="Every mention of ${esc(m.series)}">` +
      cover(m.comic, "", yr, noLab) +
    `</a>` +
    `<h3 class="band"><a href="${seriesLink}">${esc(m.series)}</a>` +
      (/#|vol|book/i.test(m.comic) ? `<span class="no">${esc(num(m.comic, null))}</span>` : "") + `</h3>` +
    `<div class="pbody">` +
      `<a class="cap" href="${epLink}">${esc(ep?.title || "Untitled episode")}</a>` +
      `<div class="credits">${esc(fmtDate(ep?.date ?? null) || "Date unknown")}` +
        `${ep?.people.length ? " · " + esc(firstNames(ep.people)) : ""}</div>` +
      (m.segment ? `<span class="seg" title="${esc(m.segment)}">${esc(m.segment)}</span>` : "") +
      `<div class="spacer"></div>` +
      `<div class="cutslot"></div>` +
      playAffordance(m, ep) +
    `</div>` +
  `</article>`;
}

export function fmtStamp(secs: number | null): string {
  return secs == null ? "" : fmtRuntime(secs);
}

/**
 * The honest not-found state. Carries its own h1 so the page has a heading, and its link
 * is underlined — blue on paper is not distinguishable from body text by hue alone.
 */
export function emptyState(title: string, message: string, linkHref: string, linkText: string): string {
  return `<div class="pagehead"><span class="eyebrow">Not in the index</span><h1 class="disp">${esc(title)}</h1></div>` +
    `<div class="empty">${esc(message)} <a href="${linkHref}">${esc(linkText)}</a></div>`;
}

/**
 * The one place a play affordance is built. Every read-along layout and every search plate
 * goes through it, so changing how playback is offered is one function, not a sweep.
 */
export function playAffordance(m: Mention, ep: EpisodeCore | undefined, opts?: { label?: string }): string {
  const epLink = href("/ep/" + encodeURIComponent(m.epKey));
  const label = opts?.label ?? "Jump";
  /* One guard, not two. jumpable() already requires an enclosure, so the "no audio, link
     out to Simplecast instead" branch that used to sit below could never be reached. */
  if (!jumpable(m, ep) || !ep?.enclosure) {
    return `<a class="ts dead" href="${epLink}">${ep?.enclosure ? "No minute logged" : "No audio on file"}` +
      `<span class="lab">Open</span></a>`;
  }
  /* Plays in the page. The engine seeks with currentTime and never touches the enclosure
     URL, so the download still counts as the download it is. */
  return `<button class="ts" type="button" data-act="cut" data-ep="${esc(m.epKey)}" data-secs="${m.secs}" data-comic="${esc(m.comic)}"` +
    ` aria-label="Play ${esc(m.comic)} at ${esc(fmtRuntime(m.secs))}">` +
    `<span class="tri">▶</span>${esc(fmtRuntime(m.secs))}<span class="lab">${label}</span></button>`;
}
