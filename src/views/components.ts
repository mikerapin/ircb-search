import type { EpisodeCore } from "../data/types";
import { esc, fmtDate, fmtRuntime, pl } from "../lib/html";
import { href } from "../router";

/** A comic cover carries a price; an episode carries a runtime. */
export function priceBox(e: EpisodeCore): string {
  const r = fmtRuntime(e.runtimeSecs);
  return r ? `<span class="pricebox">${esc(r)}<small>Runtime</small></span>` : "";
}

export function epHref(e: EpisodeCore): string {
  return href("/ep/" + encodeURIComponent(e.key));
}

/* The generated trade-dress cover (.gc) lands in Plan 2. Until then an episode with no
   artwork gets the screened slot the stylesheet already reserves — an unprinted plate,
   not a hole. */
function art(e: EpisodeCore): string {
  const link = epHref(e);
  if (!e.artwork) return `<a class="epw-art" href="${link}" aria-hidden="true" tabindex="-1"></a>`;
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
