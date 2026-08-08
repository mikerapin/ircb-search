import { core, details, mentions as loadMentions } from "../data/load";
import { ROSTER_MAP, isRoster } from "../data/roster";
import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, nf, pl } from "../lib/html";
import { href } from "../router";
import { SEARCH_CAP, jumpable, runSearch, type SearchData, type SearchQuery } from "../search/engine";
import { byDateDesc, episodePanel, mentionPanel } from "./components";
import { cover, num } from "./cover";

const SUGGESTIONS = ["Saga", "Batman", "X-Men", "Ice Cream Man", "Giant Days", "Sweet Tooth"];

let data: SearchData | null = null;
async function searchData(): Promise<SearchData> {
  if (data) return data;
  const [c, m, d] = await Promise.all([core(), loadMentions(), details()]);
  data = { core: c, mentions: m, details: d };
  return data;
}

export function readQuery(qs: URLSearchParams): SearchQuery {
  const sort = qs.get("sort");
  return {
    q: qs.get("q") ?? "",
    who: qs.get("who") || null,
    guest: qs.get("guest") === "1",
    sort: sort === "recent" || sort === "oldest" ? sort : "relevance",
  };
}

function avatar(name: string): string {
  const p = ROSTER_MAP.get(name);
  return p ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="ph"></span>`;
}

function facetHref(q: SearchQuery, over: Partial<SearchQuery>): string {
  const n = { ...q, ...over };
  const out: Record<string, string> = {};
  if (n.q) out["q"] = n.q;
  if (n.who) out["who"] = n.who;
  if (n.guest) out["guest"] = "1";
  if (n.sort !== "relevance") out["sort"] = n.sort;
  return href("/search", out);
}

function rail(q: SearchQuery, all: Mention[], byKey: Map<string, EpisodeCore>): string {
  const counts = new Map<string, number>();
  for (const m of all) {
    const e = byKey.get(m.epKey);
    if (!e) continue;
    for (const n of e.people) if (isRoster(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const names = [...counts].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  if (q.who && !counts.has(q.who)) names.unshift({ name: q.who, n: all.length });

  const sorts: Array<[SearchQuery["sort"], string]> = [
    ["relevance", "Best match"], ["recent", "Newest first"], ["oldest", "Oldest first"],
  ];

  return `<aside class="rail">` +
    `<div class="railbox"><div class="rh">Sort</div><div class="rb rows">` +
      sorts.map(([k, label]) =>
        `<a class="facet" href="${facetHref(q, { sort: k })}" aria-current="${q.sort === k}">${label}</a>`
      ).join("") +
    `</div></div>` +
    `<div class="railbox who"><div class="rh">Who was on mic</div><div class="rb rows">` +
      (q.who ? `<a class="facet" href="${facetHref(q, { who: null })}" aria-current="false"><span class="ph"></span>All panelists<span class="n">${nf(all.length)}</span></a>` : "") +
      names.slice(0, 12).map(o =>
        `<a class="facet" href="${facetHref(q, { who: o.name })}" aria-current="${q.who === o.name}">` +
          avatar(o.name) +
          `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.name)}</span>` +
          `<span class="n">${nf(o.n)}</span></a>`
      ).join("") +
      `<a class="facet" href="${facetHref(q, { guest: !q.guest })}" aria-current="${q.guest}"><span class="ph"></span>Guest episodes</a>` +
    `</div></div>` +
  `</aside>`;
}

export async function viewSearch(qs: URLSearchParams): Promise<string> {
  const q = readQuery(qs);
  const d = await searchData();
  const byKey = new Map(d.core.episodes.map(e => [e.key, e]));

  if (!q.q.trim() && !q.who && !q.guest) {
    const latest = d.core.episodes.filter(e => e.artwork && e.date).sort(byDateDesc).slice(0, 8);
    return `<div class="pagehead"><div class="eyebrow">Episodes &amp; search</div>` +
      `<h1 class="disp">Search the archive</h1>` +
      `<p>${nf(d.core.stats.mentions)} timestamped comic mentions across ${nf(d.core.stats.indexedEpisodes)} indexed episodes. ` +
      `Type in the yellow band above — or hit <b>/</b> from anywhere — and suggestions open as you type.</p>` +
      `<div class="chips" style="padding:0">${SUGGESTIONS.map(t =>
        `<a class="chip" href="${href("/search", { q: t })}">${esc(t)}</a>`).join("")}</div></div>` +
      `<section class="sec"><div class="sec-head"><h2 class="disp">Newest Episodes</h2></div>` +
        `<div class="panels">${latest.map(episodePanel).join("")}</div></section>`;
  }

  const res = runSearch(q, d);
  const unfiltered = runSearch({ ...q, who: null, guest: false }, d);
  const eps = res.episodes.slice(0, 6);
  const inEps = new Set(res.all.map(m => m.epKey)).size;   // honest, not the capped 36

  const head = `<div class="crumb"><a href="${href("/")}">← The Cover</a>` +
      (q.who ? ` · <a href="${href("/who/" + encodeURIComponent(q.who))}">${esc(q.who)}</a>` : "") + `</div>` +
    `<div class="pagehead"><div class="eyebrow">Episodes &amp; search</div>` +
      `<h1 class="disp">${esc(q.q || (q.who ?? "Guest episodes"))}</h1>` +
      `<p class="honest-count">${nf(res.mentionTotal)} mention${pl(res.mentionTotal)} in ${nf(inEps)} episode${pl(inEps)}` +
      `${q.who ? `, filtered to ${esc(q.who)}` : ""}${q.guest ? ", guest episodes only" : ""} — ` +
      `${nf(res.playable)} you can jump to.</p></div>`;

  if (!res.mentionTotal && !eps.length) {
    return head + `<div class="empty"><b>No panel for that.</b> Nothing in the index matches. Try one of these:</div>` +
      `<div class="chips" style="padding-top:14px">${SUGGESTIONS.map(t =>
        `<a class="chip" href="${href("/search", { q: t })}">${esc(t)}</a>`).join("")}</div>`;
  }

  let results = `<div>`;
  if (res.mentionTotal) {
    results += `<section class="sec mentions"><div class="sec-head"><h2 class="disp">The Page</h2>` +
      `<span class="note">Plate ink is keyed to the year</span></div>` +
      `<div class="panels">${res.mentions.map(m => mentionPanel(m, byKey.get(m.epKey))).join("")}</div>`;
    if (res.mentionTotal > SEARCH_CAP) {
      results += `<p class="lead" style="padding-top:16px;margin-bottom:0">Showing ${SEARCH_CAP} of ${nf(res.mentionTotal)}.</p>`;
    }
    results += `</section>`;
  }
  if (eps.length) {
    results += `<section class="sec episodes"><div class="sec-head"><h2 class="disp">Episodes About It</h2>` +
      `<span class="note">Matched on title, show notes and tags</span></div>` +
      `<div class="panels">${eps.map(episodePanel).join("")}</div></section>`;
  }
  results += `</div>`;

  return head + `<div class="split">${rail(q, unfiltered.all, byKey)}${results}</div>`;
}
