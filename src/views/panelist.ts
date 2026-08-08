import { core, mentions as loadMentions } from "../data/load";
import { peopleStats, sharePct } from "../data/people";
import { ROSTER_MAP, isRoster } from "../data/roster";
import { ALIASES } from "../data/shape";
import type { CoreData, EpisodeCore } from "../data/types";
import { esc, fmtDate, fmtShortDate, nf, pl } from "../lib/html";
import { href } from "../router";
import { subscribeCoupon } from "./blocks";
import { emptyState, episodePanel, sfx } from "./components";
import { fitPlates } from "./cover";

const firstName = (n: string): string => n.split(" ")[0] ?? n;

/** The feed spells one regular "Danny"; a link to that spelling must still find him. */
const canon = (n: string): string => ALIASES[n] ?? n;

function crumb(): string {
  return `<div class="crumb"><a href="${href("/")}">← The Cover</a> · <a href="${href("/panel")}">The Panel</a></div>`;
}

/** Everyone who has shared an episode with this person, by how often. */
function coPanelists(name: string, theirs: EpisodeCore[]): Array<[string, number]> {
  const tally = new Map<string, number>();
  for (const e of theirs) {
    for (const p of e.people) if (p !== name) tally.set(p, (tally.get(p) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1]);
}

function tenureStrip(name: string, data: CoreData): string {
  const byYear = new Map<string, number>();
  for (const e of data.episodes) {
    if (!e.date) continue;
    const y = e.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, 0);
    if (e.people.includes(name)) byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  return [...byYear.keys()].sort().reverse().map(y => {
    const n = byYear.get(y) ?? 0;
    return `<div class="yr${n ? " on" : ""}" title="${y}: ${n} episode${pl(n)}">${y.slice(2)}<b>${n || "–"}</b></div>`;
  }).join("");
}

export async function viewPanelist(rawName: string): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const name = canon(rawName);
  const stats = peopleStats(data.episodes);
  const person = stats.get(name);
  const roster = ROSTER_MAP.get(name);

  if (!person) {
    return {
      html: crumb() + emptyState(rawName || "Unknown name", "No one by that name in the index.",
        href("/panel"), "The full directory →"),
      after: () => {},
    };
  }

  const men = await loadMentions();
  const byKey = new Map(data.episodes.map(e => [e.key, e]));
  const theirs = person.keys.map(k => byKey.get(k)).filter((e): e is EpisodeCore => !!e);
  const nEps = person.episodes;
  const pct = (nEps / data.stats.episodes) * 100;
  const dated = theirs.filter(e => e.date);

  const co = coPanelists(name, theirs);
  const coFaces = co.filter(([n]) => isRoster(n));
  const coOthers = co.length - coFaces.length;

  // Most discussed on their watch.
  const mineKeys = new Set(person.keys);
  const mine = men.filter(m => mineKeys.has(m.epKey));
  const tally = new Map<string, number>();
  for (const m of mine) tally.set(m.series, (tally.get(m.series) ?? 0) + 1);
  const top = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);

  const recent = dated.slice(0, 8);
  const activeYears = new Set(dated.map(e => e.date?.slice(0, 4)));
  const showYears = new Set(data.episodes.map(e => e.date?.slice(0, 4)).filter(Boolean));

  const main = `<div>` +
    (coFaces.length
      ? `<section class="sec"><div class="sec-head"><h2 class="disp">Who They Sit With</h2>
          <span class="note">Share of ${esc(firstName(name))}&rsquo;s ${nf(nEps)} episode${pl(nEps)}</span></div>
          <div class="panelgrid">${coFaces.map(([who, n]) => {
            const p2 = ROSTER_MAP.get(who);
            const share = (n / nEps) * 100;
            return `<a class="pblock" href="${href("/who/" + encodeURIComponent(who))}">` +
              `<span class="por">${p2 ? `<img src="${esc(p2.photo)}" alt="" loading="lazy">` : ""}</span>` +
              `<span class="nm">${esc(p2?.display ?? who)}</span>` +
              `<span class="st"><b>${share < 1 ? share.toFixed(1) : Math.round(share)}%</b> · ${nf(n)} ep${pl(n)} together</span></a>`;
          }).join("")}</div>` +
          (coOthers > 0
            ? `<p class="lead" style="margin:14px 0 0">Plus ${nf(coOthers)} guest${pl(coOthers)} who&rsquo;ve shared the mic with ${esc(firstName(name))} — they&rsquo;re all in the credits on their episode pages.</p>`
            : "") +
        `</section>`
      : "") +
    (top.length
      ? `<section class="sec"><div class="sec-head"><h2 class="disp">Most Discussed On Their Watch</h2>
          <span class="note">From ${nf(mine.length)} indexed mention${pl(mine.length)} on their episodes</span></div>
          <div class="chips">${top.map(([s, n]) =>
            `<a class="chip" href="${href("/series/" + encodeURIComponent(s))}">${esc(s)}<span class="n">${nf(n)}</span></a>`).join("")}</div></section>`
      : "") +
    /* One episode is one square; a whole grid for that is noise (Round 2 note). */
    (nEps > 1
      ? `<section class="sec"><details class="acc"><summary>Every episode with ${esc(firstName(name))} · ${nf(nEps)}</summary>
          <div class="accb"><div class="ra-list">${theirs.map(e =>
            `<div class="rawrap"><a class="ra-row" href="${href("/ep/" + encodeURIComponent(e.key))}">` +
              `<span class="t${e.date ? "" : " none"}">${e.date ? esc(fmtShortDate(e.date)) : "——"}</span>` +
              `<span><span class="cm">${esc(e.title || "Untitled episode")}</span>` +
              `<span class="mt">${esc(e.people.filter(p => p !== name).join(" · ")) || "Solo"}</span></span>` +
              `<span class="cue">Open →</span></a></div>`).join("")}</div>` +
          (nEps - dated.length > 0
            ? `<p style="margin:12px 0 0;font-size:12px">${nf(nEps - dated.length)} of their records carry no air date.</p>`
            : "") +
          `</div></details></section>`
      : "") +
    (recent.length
      ? `<section class="sec"><div class="sec-head"><h2 class="disp">On the Panel</h2>
          <span class="note">Newest first · ${nf(nEps)} total</span></div>
          <div class="panels">${recent.map(episodePanel).join("")}</div></section>`
      : "") +
    `</div>`;

  const side = `<aside class="rail">
    <div class="railbox"><div class="rh">Tenure</div>
      <div class="rb" style="gap:4px">
        <div class="micro">First</div><div style="font-weight:700;margin-top:-4px">${esc(fmtDate(person.first) || "Unknown")}</div>
        <div class="micro" style="margin-top:6px">Latest</div><div style="font-weight:700;margin-top:-4px">${esc(fmtDate(person.latest) || "Unknown")}</div>
        <div class="micro" style="margin-top:6px">Active years</div><div style="font-weight:700;margin-top:-4px">${activeYears.size} of ${showYears.size}</div>
      </div>
      <div class="tenure">${tenureStrip(name, data)}</div>
      <div class="railnote">Inked years are the ones they were on mic. The number under each is episodes that year.</div>
    </div>` +
    (top[0]
      ? `<div class="railbox"><div class="rh">Filter a search</div><div class="rb">
          <a class="chip" href="${href("/search", { q: top[0][0], who: name })}">${esc(top[0][0])}, with ${esc(firstName(name))}</a>
        </div></div>`
      : "") +
    (roster ? "" : `<div class="railbox"><div class="rh">Guest record</div>
      <div class="railnote" style="border:0">They&rsquo;re in the episode credits but not on the roster, so there&rsquo;s no portrait or tagline — just the record.</div></div>`) +
  `</aside>`;

  const html = crumb() +
    `<section class="sec"><div class="credit-head">
      <div class="por">${roster ? `<img src="${esc(roster.photo)}" alt="Portrait of ${esc(roster.display)}">` : `<div style="aspect-ratio:1/1"></div>`}</div>
      <div class="info">
        <div class="micro">${roster ? "Credits" : "Guest credits"}</div>
        <h1 class="disp">${esc(roster?.display ?? name)}</h1>
        ${roster ? `<div class="tagline">${esc(roster.tagline)}</div>` : ""}
        <div class="statline"><b>${nf(nEps)}</b> episode${pl(nEps)} · <b>${pct < 1 ? pct.toFixed(1) : sharePct(nEps, data.stats.episodes)}%</b> of all ${nf(data.stats.episodes)} · ` +
          (nEps === 1 ? esc(fmtShortDate(person.first)) : `${esc(fmtShortDate(person.first))} → ${esc(fmtShortDate(person.latest))}`) + `</div>
      </div>
    </div></section>` +
    sfx(`${nf(nEps)} episode${pl(nEps)}`) +
    `<div class="split">${side}${main}</div>` +
    subscribeCoupon(`Follow ${firstName(name)} into next week.`);

  return { html, after: () => { requestAnimationFrame(() => fitPlates(document)); } };
}
