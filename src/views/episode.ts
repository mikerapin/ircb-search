import { core, details, mentions as loadMentions } from "../data/load";
import { ROSTER_MAP } from "../data/roster";
import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { subscribeCoupon } from "./blocks";
import { emptyState, episodePanel, sfx } from "./components";
import { blankVariant, fitPlates } from "./cover";
import { raToggle, readAlong, rollToggle, wireReadAlong } from "./readalong";

/** Shared books count triple; a shared panelist counts once. */
function related(ep: EpisodeCore, episodes: EpisodeCore[], byEp: Map<string, Mention[]>): EpisodeCore[] {
  const mine = new Set((byEp.get(ep.key) ?? []).map(m => m.series));
  const crew = new Set(ep.people);
  const scored: Array<{ e: EpisodeCore; sc: number }> = [];
  for (const o of episodes) {
    if (o.key === ep.key || !o.title) continue;
    let sc = 0;
    for (const m of byEp.get(o.key) ?? []) if (mine.has(m.series)) sc += 3;
    for (const p of o.people) if (crew.has(p)) sc += 1;
    if (sc > 0) scored.push({ e: o, sc });
  }
  scored.sort((a, b) => b.sc - a.sc || (b.e.date ?? "").localeCompare(a.e.date ?? ""));
  return scored.slice(0, 4).map(x => x.e);
}

function crumb(): string {
  return `<div class="crumb"><a href="${href("/")}">← The Cover</a></div>`;
}

function avatar(name: string): string {
  const p = ROSTER_MAP.get(name);
  return p ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="ph"></span>`;
}

export async function viewEpisode(key: string): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const ep = data.episodes.find(e => e.key === key);
  if (!ep) {
    return {
      html: crumb() + emptyState("Episode not found", "No episode by that id in the index.", href("/"), "Back to the cover"),
      after: () => {},
    };
  }

  const [men, det] = await Promise.all([loadMentions(), details()]);
  const byKey = new Map(data.episodes.map(e => [e.key, e]));
  const byEp = new Map<string, Mention[]>();
  for (const m of men) {
    let list = byEp.get(m.epKey);
    if (!list) byEp.set(m.epKey, (list = []));
    list.push(m);
  }
  /* Un-timestamped mentions sort last, not first. `a.secs ?? 0` collapsed every one of
     them to zero, so a heading that reads "in broadcast order" led with every comic whose
     minute was never logged. */
  for (const list of byEp.values()) {
    list.sort((a, b) => {
      if (a.secs == null && b.secs == null) return 0;
      if (a.secs == null) return 1;
      if (b.secs == null) return -1;
      return a.secs - b.secs;
    });
  }

  const mine = byEp.get(ep.key) ?? [];
  const detail = det.get(ep.key);
  const rel = related(ep, data.episodes, byEp);
  const n = mine.length;

  /* A tag that names a book we shelve goes to the shelf; everything else runs a search.
     Most terms spell their own heading, and a tagged term always leaves a mention on this
     episode under it, so this episode's own rows answer the common case without the build
     shipping a lookup for it. `keywordSeries` carries only the terms that spell something
     else — and because it is consulted first, it also wins when the two disagree. */
  const ownSeries = new Map(mine.map(m => [m.series.toLowerCase(), m.series]));
  const tagHref = (k: string): string => {
    const series = detail?.keywordSeries?.[k] ?? ownSeries.get(k.trim().toLowerCase());
    return series
      ? href("/series/" + encodeURIComponent(series))
      : href("/search", { q: k });
  };

  /* The cover is square and the row is not, so the leftover is a screened tint field. Left
     carrying two lines it read as a failed image, so it carries the episode's whole
     colophon instead — the facts that used to sit twice over in the right column. */
  const jumps = mine.filter(m => jumpable(m, ep)).length;
  const row = (k: string, v: string): string => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const source = ep.simplecastUrl
    ? `<a href="${esc(ep.simplecastUrl)}">Simplecast &rarr;</a>`
    : ep.patreonUrl
      ? `<a href="${esc(ep.patreonUrl)}">Patreon &rarr;</a>`
      : "Not in the public feed";

  const colophon = `<div class="artcap"><dl class="colo">` +
    row("Aired", esc(fmtDate(ep.date)) || "No date on file") +
    (ep.runtimeSecs ? row("Runtime", esc(fmtRuntime(ep.runtimeSecs))) : "") +
    /* "7 indexed · 7 playable" says the same thing twice. The second figure earns its
       place only when some of them can't be played. */
    row("Comics", n ? `${n} indexed${jumps < n ? ` &middot; ${jumps} playable` : ""}` : "None indexed") +
    row("Listen", source) +
  `</dl></div>`;

  const art = ep.artwork
    ? `<div class="art"><img src="${esc(ep.artwork)}" alt="Episode artwork">${colophon}</div>`
    : `<div class="art" style="container-type:inline-size;background:var(--paper)">${blankVariant(ep)}${colophon}</div>`;

  /* A whole episode deserves a way to start it, not just a jump into somebody else's minute.
     Plan 3 turns this into the in-page player; until then it opens the episode at Simplecast. */
  const play = ep.enclosure
    ? `<button class="big-play" type="button" data-act="cut-ep" data-ep="${esc(ep.key)}" data-secs="0">` +
        `<span aria-hidden="true">▶</span> Play from the top</button>`
    : ep.patreonUrl
      ? `<a class="big-play" href="${esc(ep.patreonUrl)}" target="_blank" rel="noopener noreferrer">` +
          `<span aria-hidden="true">▶</span> Listen on Patreon</a>`
      : "";

  const head = crumb() +
    `<section class="sec"><div class="issue-head">${art}
      <div class="meta">
        <h1 class="disp">${esc(ep.title || "Untitled episode")}</h1>
        <div class="crew">${ep.people.map(p =>
          `<a href="${href("/who/" + encodeURIComponent(p))}">${avatar(p)}${esc(p)}</a>`).join("")}</div>
        ${detail?.summary
          ? `<p class="notes">${esc(detail.summary)}</p>`
          : `<p class="notes">We didn&rsquo;t write show notes for this one.</p>`}
        ${detail?.keywords.length
          ? `<div class="tags">${detail.keywords.slice(0, 10).map(k =>
              `<a class="tag" href="${tagHref(k)}">${esc(k)}</a>`).join("")}</div>`
          : ""}
        ${play}
        <div class="cutslot"></div>
        ${ep.simplecastUrl && ep.patreonUrl
          ? `<div class="linkrow"><a href="${esc(ep.patreonUrl)}">On Patreon →</a></div>`
          : ""}
      </div>
    </div></section>` +
    /* "mention", not "moment": most of these carry no minute, and since the RSS keywords
       started feeding the index some were never logged against a point in the tape at all. */
    sfx(n ? `${nf(n)} mention${pl(n)}` : "Not indexed");

  const raSection = (): string =>
    `<div class="sec-head"><h2 class="disp">Read Along</h2>
      <div class="tools">${raToggle()}${rollToggle()}</div>
      <span class="note">In broadcast order · a jump stops at the next comic unless you let it roll</span></div>` +
    readAlong(mine, byKey, { episodes: data.stats.episodes, indexed: data.stats.indexedEpisodes });

  const html = head +
    `<section class="sec" id="readalong">${raSection()}</section>` +
    (rel.length
      ? `<section class="sec">
          <div class="sec-head"><h2 class="disp">If You Liked This One</h2><span class="note">Shared books &amp; shared panel</span></div>
          <div class="panels">${rel.map(e => episodePanel(e)).join("")}</div>
        </section>`
      : "") +
    subscribeCoupon();

  const after = (): void => {
    const host = document.getElementById("readalong");
    if (!host) return;
    const paint = (): void => {
      host.innerHTML = raSection();
      wireReadAlong(host, paint);
      requestAnimationFrame(() => fitPlates(host));
    };
    wireReadAlong(host, paint);
    requestAnimationFrame(() => fitPlates(document));
  };

  return { html, after };
}
