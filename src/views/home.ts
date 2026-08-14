import { core, mentions as loadMentions } from "../data/load";
import type { EpisodeCore } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl } from "../lib/html";
import { href } from "../router";
import { patreonAd, panelGrid, shuffle, spinnerRack, statement, subscribeCoupon } from "./blocks";
import { feedNumbers } from "../data/numbering";
import { byDateDesc, epHref, episodeBadge, episodePanel, sfx } from "./components";
import { fitPlates } from "./cover";

/** Measure after the browser has laid the grid out, not in the same tick we injected it. */
const refit = (root: ParentNode): void => { requestAnimationFrame(() => fitPlates(root)); };

const RECENT = 8;

function hero(e: EpisodeCore, feedNo: number | undefined): string {
  const badge = episodeBadge(e, feedNo);
  return `<section class="sec">
    <div class="cover-hero">
      ${/* Both of these used to be pinned on top of the artwork. The flag sat over the
            bottom-left corner, which is where Mike's covers print their price, and the
            runtime box over the top-right. The cover is the one thing on this page nobody
            needs help reading, so the flag is a band under it and the runtime has joined the
            metadata line beside the title with the rest of the facts. */""}
      <div class="hero-art">
        ${e.artwork ? `<img src="${esc(e.artwork)}" alt="Episode artwork for ${esc(e.title)}">` : ""}
        <span class="hero-flag">This week's episode</span>
      </div>
      <div class="hero-side">
        ${/* The number was inside the micro line, set at 10px between the date and the comic
              count, and the first thing a reader asked of this page was which episode it is.
              It is the episode's name, so it is now the first thing on the plate and reads
              as a number rather than as metadata. */
          badge ? `<div class="hero-no">${badge}</div>` : ""}
        <div class="micro">${esc(fmtDate(e.date))}${
          e.runtimeSecs ? " · " + esc(fmtRuntime(e.runtimeSecs)) : ""
        } · ${e.mentionCount} comic${pl(e.mentionCount)} indexed</div>
        <h1 class="hero-title disp"><a href="${epHref(e)}" style="color:inherit">${esc(e.title)}</a></h1>
        <div class="credits">${esc(e.people.join(", "))}</div>
        <a class="big-play" href="${epHref(e)}"><span aria-hidden="true">▶</span> Read &amp; listen</a>
      </div>
    </div>
  </section>`;
}

/**
 * Home paints from `core.json` alone, then fills the Shuffle and the Spinner Rack once
 * the mention list arrives. Keeping the first paint to one fetch is a Plan 1 exit check
 * with a spec behind it — these two blocks are the only ones that need more.
 */
export async function viewHome(): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const { stats, episodes } = data;
  const dated = episodes.filter(e => e.date !== null).sort(byDateDesc);
  const top = dated.find(e => e.artwork && e.enclosure) ?? dated[0];
  if (!top) return { html: `<div class="pagehead"><h1 class="disp">Nothing in the index yet</h1></div>`, after: () => {} };

  const recent = dated.filter(e => e.key !== top.key && e.artwork).slice(0, RECENT);

  const html =
    hero(top, feedNumbers(episodes).get(top.key)) +
    sfx(nf(stats.mentions) + " comics!") +
    `<div id="home-shuffle"></div>` +
    statement(data) +
    `<div id="home-rack"></div>` +
    panelGrid(data) +
    `<section class="sec">
      <div class="sec-head"><h2 class="disp">Recent Episodes</h2>
        <span class="note">Newest in the index<br><a href="${href("/search")}">Search all ${nf(stats.episodes)} episodes →</a></span></div>
      <div class="panels">${recent.map(e => episodePanel(e)).join("")}</div>
    </section>` +
    patreonAd(data) +
    subscribeCoupon();

  const after = (): void => {
    refit(document);
    void loadMentions().then(men => {
      const rack = document.getElementById("home-rack");
      const shuf = document.getElementById("home-shuffle");
      if (!rack || !shuf) return;      // navigated away before the data landed
      shuf.innerHTML = shuffle(data, men);
      rack.innerHTML = spinnerRack(men);
      refit(shuf);
      refit(rack);
    });
  };

  return { html, after };
}
