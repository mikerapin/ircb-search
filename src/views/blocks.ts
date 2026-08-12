import { peopleStats, sharePct } from "../data/people";
import { ROSTER } from "../data/roster";
import { seriesRows } from "../data/series-index";
import type { CoreData, EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, fmtShortDate, nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { cover } from "./cover";

const SUBSCRIBE = {
  apple: "https://podcasts.apple.com/us/podcast/i-read-comic-books/id981964360",
  spotify: "https://open.spotify.com/show/2XNmyG7TfF3FzTqmGxLoIJ",
  rss: "https://feeds.simplecast.com/U93zjuSN",
  patreon: "https://patreon.com/ircbpodcast",
};

/* ---------- Statement of Circulation ---------- */

export function statement(core: CoreData): string {
  const s = core.stats;
  const newest = core.episodes.reduce<string | null>((d, e) => (e.date && (!d || e.date > d) ? e.date : d), null);
  const tiles: Array<[value: string, label: string]> = [
    [nf(s.episodes), "Episodes published"],
    // Not "timestamped": most logged comics carry no minute. About the Data quotes the
    // live split; don't copy a figure here, it goes stale the week the data refreshes.
    [nf(s.mentions), "Comics logged"],
    [nf(s.series), "Distinct series"],
    [nf(s.people), "Panelists &amp; guests"],
  ];
  return `<section class="sec">
    <div class="sec-head"><h2 class="disp">Statement of Circulation</h2>
      <span class="note">${newest ? "Through " + esc(fmtDate(newest)) : ""}</span></div>
    <div class="stats">${tiles.map(([v, l]) =>
      `<div class="st"><div class="n">${v}</div><div class="l">${l}</div></div>`).join("")}</div>
  </section>`;
}

/* ---------- The Spinner Rack ---------- */

export function spinnerRack(mentions: Mention[]): string {
  const top = seriesRows(mentions).slice(0, 18);
  if (!top.length) return "";
  return `<section class="sec">
    <div class="sec-head screened"><h2 class="disp">The Spinner Rack</h2>
      <span class="note">Most discussed on air<br>Tap a cover for the whole run</span></div>
    <div class="rack">${top.map(t =>
      `<a class="slot" href="${href("/series/" + encodeURIComponent(t.name))}" style="container-type:inline-size" aria-label="${esc(t.name)}, ${t.mentions} mention${pl(t.mentions)}">` +
        cover(t.name, "tall", t.name, null) +
        `<span class="cnt">${nf(t.mentions)} mention${pl(t.mentions)}</span></a>`).join("")}</div>
  </section>`;
}

/* ---------- The Panel ---------- */

export function panelGrid(core: CoreData): string {
  const stats = peopleStats(core.episodes);
  const rows = ROSTER
    .map(p => ({ p, n: stats.get(p.name)?.episodes ?? 0 }))
    .sort((a, b) => b.n - a.n);
  return `<section class="sec">
    <div class="sec-head"><h2 class="disp">The Panel</h2>
      <span class="note">${ROSTER.length} regulars · ${nf(core.stats.people)} people have sat at this table<br>
        <a href="${href("/panel")}">The full directory →</a></span></div>
    <div class="panelgrid">${rows.map(({ p, n }) =>
      `<a class="pblock" href="${href("/who/" + encodeURIComponent(p.name))}">` +
        `<span class="por"><img src="${esc(p.photo)}" alt="" loading="lazy"></span>` +
        `<span class="nm">${esc(p.display)}</span>` +
        `<span class="st">${nf(n)} ep${pl(n)} · ${sharePct(n, core.stats.episodes)}%</span></a>`).join("")}</div>
  </section>`;
}

/* ---------- Only on Patreon ---------- */

export function patreonAd(core: CoreData): string {
  const runs = core.patreonSeries;
  if (!runs.length) return "";

  /* Episodes, not series, is the honest size of the thing being sold: the runs listed here
     used to cover half the shelf while the ad implied they were all of it. */
  const total = core.episodes.filter(e => e.key.startsWith("p:")).length;

  return `<section class="sec"><div class="housead">
    <div class="hh"><span class="k">Only on Patreon</span>
      <span class="s">${runs.length} runs · ${nf(total)} episodes · house ad</span></div>
    <div class="hb">
      <p>Some episodes are only available to those willing to toss a few bucks to us, all on Patreon.</p>
      <div class="adgrid">${runs.map(p =>
        `<a class="adslot" href="${esc(p.url)}" style="container-type:inline-size">` +
          cover(p.name, "", p.name, "PAT") +
          `<span class="nm">${esc(p.name)}</span>` +
          `<span class="go">${nf(p.episodes)} episode${pl(p.episodes)} →</span></a>`).join("")}</div>
      <div class="linkrow"><a href="${SUBSCRIBE.patreon}">patreon.com/ircbpodcast →</a></div>
    </div>
  </div></section>`;
}

/* ---------- cut-out coupon ---------- */

export function subscribeCoupon(line?: string): string {
  return `<section class="sec"><div class="coupon">
    <span class="scissors" aria-hidden="true">✂</span>
    <div class="in">
      <h2 class="disp">Next Wednesday, they do it again.</h2>
      <p style="margin:0;max-width:58ch">${esc(line ?? "New episode every Wednesday since 2015. Three people, a stack of comics, one hour — all catalogued in this index.")}</p>
      <div class="subs">
        <a href="${SUBSCRIBE.apple}">Apple Podcasts</a>
        <a href="${SUBSCRIBE.spotify}">Spotify</a>
        <a class="alt" href="${SUBSCRIBE.rss}">RSS</a>
        <a class="alt" href="${SUBSCRIBE.patreon}">Patreon</a>
      </div>
    </div>
  </div></section>`;
}

export { SUBSCRIBE };

/* ---------- The Shuffle ---------- */

const pick = <T,>(a: T[]): T | undefined => a[Math.floor(Math.random() * a.length)];


export function shuffle(core: CoreData, mentions: Mention[]): string {
  const stats = peopleStats(core.episodes);
  const person = pick(ROSTER);
  const ps = person ? stats.get(person.name) : undefined;

  /* Back catalogue = dated, indexed, and at least two years old. The point is a dig,
     not the same recent episodes the rest of the page already shows. */
  const cutoff = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const byKey = new Map(core.episodes.map(e => [e.key, e]));
  const pool = core.episodes.filter(e => e.date && e.date < cutoff && e.mentionCount > 0);
  const ep = pick(pool);

  const playable = mentions.filter(m => jumpable(m, byKey.get(m.epKey)));
  const men = pick(playable);
  const menEp = men ? byKey.get(men.epKey) : undefined;

  if (!person || !ep || !men || !menEp) return "";

  return `<section class="sec">
    <div class="sec-head"><h2 class="disp">The Shuffle</h2>
      <span class="note">Three we pulled at random<br>Reload if you want three more</span></div>
    <div class="threeup">

      <div class="sh"><div class="shh">A panelist<span class="dice" aria-hidden="true">⚄</span></div>
        <div class="shb"><div class="toprow">
          <span class="por"><img src="${esc(person.photo)}" alt="" loading="lazy"></span>
          <div style="min-width:0"><h3 class="disp"><a href="${href("/who/" + encodeURIComponent(person.name))}" style="color:inherit">${esc(person.display)}</a></h3>
          <div class="credits" style="margin-top:5px">${nf(ps?.episodes ?? 0)} episode${pl(ps?.episodes ?? 0)} · ${sharePct(ps?.episodes ?? 0, core.stats.episodes)}% of the run</div></div>
        </div>
        <p class="cap" style="margin:0">${esc(person.tagline)}</p>
        <div class="spacer"></div>
        <div class="credits">${esc(fmtShortDate(ps?.first ?? null))} → ${esc(fmtShortDate(ps?.latest ?? null))}</div>
      </div></div>

      <div class="sh"><div class="shh">From the back catalogue<span class="dice" aria-hidden="true">⚅</span></div>
        <div class="shb">
          <div class="credits">${esc(fmtDate(ep.date))}${ep.runtimeSecs ? " · " + esc(fmtRuntime(ep.runtimeSecs)) : ""}</div>
          <h3 class="disp"><a href="${href("/ep/" + encodeURIComponent(ep.key))}" style="color:inherit">${esc(ep.title || "Untitled episode")}</a></h3>
          <div class="credits">${esc(ep.people.join(", "))}</div>
          <div class="spacer"></div>
          <a class="ts dark" href="${href("/ep/" + encodeURIComponent(ep.key))}"><span class="tri">▤</span>Open the episode<span class="lab">${ep.mentionCount} comic${pl(ep.mentionCount)}</span></a>
        </div></div>

      <div class="sh"><div class="shh">One comic, one minute<span class="dice" aria-hidden="true">⚂</span></div>
        <div class="shb">
          <h3 class="disp" style="font-size:19px"><a href="${href("/series/" + encodeURIComponent(men.series))}" style="color:inherit">${esc(men.comic)}</a></h3>
          <div class="credits">${esc(menEp.title)}</div>
          ${men.segment ? `<span class="seg">${esc(men.segment)}</span>` : ""}
          <div class="spacer"></div>
          <a class="ts" href="${href("/ep/" + encodeURIComponent(men.epKey))}"><span class="tri">▶</span>${esc(stamp(men.secs))}<span class="lab">Jump</span></a>
        </div></div>

    </div>
  </section>`;
}

function stamp(secs: number | null): string {
  return secs == null ? "" : fmtRuntime(secs);
}
