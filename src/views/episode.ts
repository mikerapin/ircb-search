import { core, details, mentions as loadMentions } from "../data/load";
import { ROSTER_MAP } from "../data/roster";
import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl } from "../lib/html";
import { href } from "../router";
import { subscribeCoupon } from "./blocks";
import { emptyState, episodePanel, priceBox, sfx } from "./components";
import { blankVariant, fitPlates } from "./cover";
import { raToggle, readAlong, wireReadAlong } from "./readalong";

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
  for (const list of byEp.values()) list.sort((a, b) => (a.secs ?? 0) - (b.secs ?? 0));

  const mine = byEp.get(ep.key) ?? [];
  const detail = det.get(ep.key);
  const rel = related(ep, data.episodes, byEp);
  const n = mine.length;

  const art = ep.artwork
    ? `<div class="art"><img src="${esc(ep.artwork)}" alt="Episode artwork">${priceBox(ep)}` +
        `<div class="artcap">Simplecast &middot; ${esc(fmtDate(ep.date) || "undated")}<br>${n} comic${pl(n)} indexed</div></div>`
    : `<div class="art" style="container-type:inline-size;background:var(--paper)">${blankVariant(ep)}</div>`;

  /* A whole episode deserves a way to start it, not just a jump into somebody else's minute.
     Plan 3 turns this into the in-page player; until then it opens the episode at Simplecast. */
  const play = ep.simplecastUrl
    ? `<a class="big-play" href="${esc(ep.simplecastUrl)}" target="_blank" rel="noopener noreferrer">` +
        `<span aria-hidden="true">▶</span> Play from the top</a>`
    : ep.patreonUrl
      ? `<a class="big-play" href="${esc(ep.patreonUrl)}" target="_blank" rel="noopener noreferrer">` +
          `<span aria-hidden="true">▶</span> Listen on Patreon</a>`
      : "";

  const head = crumb() +
    `<section class="sec"><div class="issue-head">${art}
      <div class="meta">
        <div class="micro">${esc(fmtDate(ep.date) || "Date unknown")}${ep.runtimeSecs ? " · " + esc(fmtRuntime(ep.runtimeSecs)) : ""} · ${n} comic${pl(n)} indexed</div>
        <h1 class="disp">${esc(ep.title || "Untitled episode")}</h1>
        <div class="crew">${ep.people.map(p =>
          `<a href="${href("/who/" + encodeURIComponent(p))}">${avatar(p)}${esc(p)}</a>`).join("")}</div>
        ${detail?.summary
          ? `<p class="notes">${esc(detail.summary)}</p>`
          : `<p class="notes">No show notes on file for this episode.</p>`}
        ${detail?.keywords.length
          ? `<div class="tags">${detail.keywords.slice(0, 10).map(k =>
              `<a class="tag" href="${href("/search", { q: k })}">${esc(k)}</a>`).join("")}</div>`
          : ""}
        ${play}
        <div class="linkrow">
          ${ep.simplecastUrl ? `<a href="${esc(ep.simplecastUrl)}">Listen at Simplecast →</a>` : ""}
          ${ep.patreonUrl ? `<a href="${esc(ep.patreonUrl)}">On Patreon →</a>` : ""}
        </div>
      </div>
    </div></section>` +
    sfx(n ? `${nf(n)} moment${pl(n)}` : "Not indexed");

  const raSection = (): string =>
    `<div class="sec-head"><h2 class="disp">Read Along</h2>
      <div class="tools">${raToggle()}</div>
      <span class="note">In broadcast order · your layout choice is remembered across the site</span></div>` +
    readAlong(mine, byKey, { episodes: data.stats.episodes, indexed: data.stats.indexedEpisodes });

  const html = head +
    `<section class="sec" id="readalong">${raSection()}</section>` +
    (rel.length
      ? `<section class="sec">
          <div class="sec-head"><h2 class="disp">If You Liked This One</h2><span class="note">Shared books &amp; shared panel</span></div>
          <div class="panels">${rel.map(episodePanel).join("")}</div>
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
