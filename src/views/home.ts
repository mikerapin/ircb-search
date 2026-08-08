import { core } from "../data/load";
import type { EpisodeCore } from "../data/types";
import { esc, fmtDate, nf, pl } from "../lib/html";
import { href } from "../router";
import { byDateDesc, epHref, episodePanel, priceBox, sfx } from "./components";

const RECENT = 8;

function hero(e: EpisodeCore, episodes: number): string {
  return `<section class="sec">
    <div class="cover-hero">
      <div class="hero-art">
        <span class="hero-flag">This week's episode</span>
        ${e.artwork ? `<img src="${esc(e.artwork)}" alt="Episode artwork for ${esc(e.title)}">` : ""}
        ${priceBox(e)}
      </div>
      <div class="hero-side">
        <div class="micro" style="opacity:.7">EP. ${episodes} · ${esc(fmtDate(e.date))} · ${e.mentionCount} comic${pl(e.mentionCount)} indexed</div>
        <h1 class="hero-title disp"><a href="${epHref(e)}" style="color:inherit">${esc(e.title)}</a></h1>
        <div class="credits">${esc(e.people.join(", "))}</div>
        <a class="big-play" href="${epHref(e)}"><span aria-hidden="true">▶</span> Read &amp; listen</a>
      </div>
    </div>
  </section>`;
}

export async function viewHome(): Promise<string> {
  const { stats, episodes } = await core();
  const dated = episodes.filter(e => e.date !== null).sort(byDateDesc);
  const top = dated.find(e => e.artwork && e.enclosure) ?? dated[0];
  if (!top) return `<div class="pagehead"><h1 class="disp">Nothing in the index yet</h1></div>`;

  const recent = dated.filter(e => e.key !== top.key && e.artwork).slice(0, RECENT);

  return hero(top, stats.episodes) +
    sfx(nf(stats.mentions) + " comics!") +
    `<section class="sec">
      <div class="sec-head"><h2 class="disp">Recent Episodes</h2>
        <span class="note">Newest in the index<br><a href="${href("/search")}">Search all ${nf(stats.episodes)} episodes →</a></span></div>
      <div class="panels">${recent.map(episodePanel).join("")}</div>
    </section>`;
}
