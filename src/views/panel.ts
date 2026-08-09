import { core } from "../data/load";
import { guestNames, peopleStats, sharePct } from "../data/people";
import { ALIASED_REGULARS, ROSTER } from "../data/roster";
import { azBuckets } from "../lib/az";
import { esc, fmtShortDate, nf, pl } from "../lib/html";
import { href } from "../router";
import { subscribeCoupon } from "./blocks";

/**
 * The roster is written down; the guest list is not. Everyone in the episode credits who
 * isn't a regular lands here, counted off the same records their own page reads.
 */
export async function viewPanel(): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const stats = peopleStats(data.episodes);
  const guests = guestNames(data.episodes);
  const buckets = azBuckets(guests, n => n);

  const regulars = ROSTER
    .map(p => ({ p, s: stats.get(p.name) }))
    .sort((a, b) => (b.s?.episodes ?? 0) - (a.s?.episodes ?? 0));

  const html =
    `<div class="pagehead"><div class="eyebrow">Index</div><h1 class="disp">Panelists &amp; Guests</h1>
      <p>${nf(ROSTER.length)} regulars, with portraits and taglines. Everyone else is a name the index knows —
      a creator who came on, a friend who filled a chair. Everybody gets a page.</p>
      <div class="statline" style="max-width:none"><b>${nf(data.stats.people)}</b> names in the archive ·
        <b>${nf(ROSTER.length)}</b> on the roster · <b>${nf(guests.length)}</b> guests
        <span class="note">(${ALIASED_REGULARS} regulars are credited by a short name in some episodes; those fold into one page)</span></div></div>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">The Regulars</h2>
        <span class="note">${nf(ROSTER.length)} · by episode count</span></div>
      <div class="panelgrid">${regulars.map(({ p, s }) => {
        const n = s?.episodes ?? 0;
        return `<a class="pblock" href="${href("/who/" + encodeURIComponent(p.name))}">` +
          `<span class="por"><img src="${esc(p.photo)}" alt="" loading="lazy"></span>` +
          `<span class="nm">${esc(p.display)}</span>` +
          `<span class="tag">${esc(p.tagline)}</span>` +
          `<span class="st">${nf(n)} ep${pl(n)} · ${sharePct(n, data.stats.episodes)}% · ` +
            `${esc(fmtShortDate(s?.first ?? null))} → ${esc(fmtShortDate(s?.latest ?? null))}</span></a>`;
      }).join("")}</div>
    </section>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">Guests</h2>
        <span class="note">${nf(guests.length)} names in the panel field</span></div>
      <p class="lead">Creators, friends of the show and one-off chairs — counted straight off the credits of
      all ${nf(data.stats.episodes)} episodes. The number is how many times they sat in.</p>
      <div class="azgrid">${buckets.map(b =>
        `<div class="azsec"><h3>${b.letter}<span>${nf(b.rows.length)}</span></h3>` +
          b.rows.map(name => {
            const n = stats.get(name)?.episodes ?? 0;
            return `<a class="azrow" href="${href("/who/" + encodeURIComponent(name))}">` +
              `<span class="nm">${esc(name)}</span>` +
              `<span class="n" title="${n} episode${pl(n)}">${nf(n)}</span></a>`;
          }).join("") +
        `</div>`).join("")}</div>
    </section>` +

    subscribeCoupon();

  return { html, after: () => {} };
}
